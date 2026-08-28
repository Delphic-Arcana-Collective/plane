import type { TIssue, TIssueComment } from "@plane/types";
import type { Env } from "../env.js";
import type { LinearSyncSnapshot } from "../linear/client.js";
import { filterIssues } from "../mapper/index.js";
import type { CacheBackend, KvCacheBackend as KvCacheBackendInterface } from "./backend.js";
import { SYNC_SCHEDULED_AT_KEY } from "./backend.js";
import { deserializePlaneCache, KV_KEYS, serializePlaneCache } from "./serialization.js";
import { MemoryCacheBackend } from "./store.js";
import { resetProjectUserProperties } from "./user-properties.js";
import { D1Repository } from "../db/repository.js";
import { BFF_WORKSPACE_ID } from "../bootstrap/session.js";

function logKvError(operation: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[bff] KV ${operation} failed:`, message);
}

export class D1KvCacheBackend extends MemoryCacheBackend implements KvCacheBackendInterface {
  private loaded = false;
  private readonly repo: D1Repository;

  constructor(
    private readonly db: D1Database,
    private readonly kv: KVNamespace,
    workspaceId: string = BFF_WORKSPACE_ID
  ) {
    super();
    this.repo = new D1Repository(db, workspaceId);
  }

  get repository(): D1Repository {
    return this.repo;
  }

  private async kvDelete(key: string): Promise<void> {
    try {
      await this.kv.delete(key);
    } catch (error) {
      logKvError(`delete ${key}`, error);
    }
  }

  private async invalidateSnapshotCache(): Promise<void> {
    await Promise.all([KV_KEYS.snapshot, KV_KEYS.meta].map((key) => this.kvDelete(key)));
    this.loaded = false;
  }

  override async ensureLoaded(): Promise<void> {
    if (this.loaded && this.inner.ready) return;

    let kvSnapshot: ReturnType<typeof deserializePlaneCache> | null = null;
    try {
      const snapshotRaw = await this.kv.get(KV_KEYS.snapshot);
      if (snapshotRaw) {
        kvSnapshot = deserializePlaneCache(snapshotRaw);
      }
    } catch (error) {
      logKvError("read snapshot", error);
    }

    const d1LastSync = await this.getLastCompletedAt();
    if (kvSnapshot && d1LastSync) {
      const kvTime = kvSnapshot.lastFetchedAt ? Date.parse(kvSnapshot.lastFetchedAt) : 0;
      const d1Time = Date.parse(d1LastSync);
      if (Number.isFinite(d1Time) && Number.isFinite(kvTime) && d1Time > kvTime) {
        await this.invalidateSnapshotCache();
        kvSnapshot = null;
      }
    }

    if (kvSnapshot) {
      this.replaceCache(kvSnapshot);
      this.loaded = true;
      return;
    }

    const cache = await this.repo.loadPlaneCache();
    this.replaceCache(cache);
    if (cache.ready) {
      try {
        await this.kv.put(KV_KEYS.snapshot, serializePlaneCache(cache), { expirationTtl: 3600 });
      } catch (error) {
        logKvError("write snapshot", error);
      }
    }
    this.loaded = true;
  }

  override async reset(): Promise<void> {
    resetProjectUserProperties();
    await Promise.all([KV_KEYS.snapshot, KV_KEYS.meta].map((key) => this.kvDelete(key)));
    this.loaded = false;
    const cache = await this.repo.loadPlaneCache();
    this.replaceCache(cache);
    this.loaded = true;
  }

  override async applySnapshot(snapshot: LinearSyncSnapshot, env: Env): Promise<void> {
    await this.repo.replaceLinearSnapshot(snapshot, env);
    await this.invalidateSnapshotCache();
    await this.ensureLoaded();
  }

  override async setError(message: string): Promise<void> {
    await this.repo.setSyncError(message);
    this.inner = { ...this.inner, error: message };
  }

  override async tryAcquireSyncLock(): Promise<boolean> {
    return this.repo.tryAcquireLinearLock("sync");
  }

  override async releaseSyncLock(): Promise<void> {
    await this.repo.releaseLinearLock();
  }

  async markWebhookDeliveryProcessed(deliveryId: string): Promise<boolean> {
    return this.repo.markWebhookDeliveryProcessed(deliveryId);
  }

  async scheduleSyncAt(isoTimestamp: string): Promise<void> {
    await this.kv.put(SYNC_SCHEDULED_AT_KEY, isoTimestamp);
  }

  async getScheduledSyncAt(): Promise<string | null> {
    return this.kv.get(SYNC_SCHEDULED_AT_KEY);
  }

  async getLastCompletedAt(): Promise<string | null> {
    const row = await this.db
      .prepare(`SELECT last_linear_sync_at FROM sync_meta WHERE id = 'default'`)
      .first<{ last_linear_sync_at: string | null }>();
    return row?.last_linear_sync_at ?? null;
  }

  async isSyncInProgress(): Promise<boolean> {
    return this.repo.isLinearLockHeld();
  }

  async upsertPlaneIssue(issue: TIssue, projectName: string): Promise<void> {
    await this.repo.upsertPlaneIssue(issue, projectName);
    await this.invalidateSnapshotCache();
  }

  async deletePlaneIssue(issueId: string): Promise<boolean> {
    const deleted = await this.repo.deletePlaneIssue(issueId);
    if (deleted) await this.invalidateSnapshotCache();
    return deleted;
  }

  async upsertPlaneComment(comment: TIssueComment, issueExternalId: string): Promise<void> {
    await this.repo.upsertPlaneComment(comment, issueExternalId);
    await this.invalidateSnapshotCache();
  }

  async deletePlaneComment(commentId: string): Promise<boolean> {
    const deleted = await this.repo.deletePlaneComment(commentId);
    if (deleted) await this.invalidateSnapshotCache();
    return deleted;
  }

  override getProjectIssues(projectId: string, query: Record<string, string | undefined> = {}) {
    // rowsToPlaneCache indexes merged Linear+Plane issues under every namesake project id.
    const direct = this.inner.issuesByProject.get(projectId);
    if (direct && direct.length > 0) return filterIssues(direct, query);

    const project = this.inner.projects.find((entry) => entry.id === projectId);
    if (!project) return super.getProjectIssues(projectId, query);

    const namesakeIds = this.inner.projects.filter((entry) => entry.name === project.name).map((entry) => entry.id);
    const merged: TIssue[] = [];
    const seen = new Set<string>();
    for (const id of namesakeIds) {
      for (const issue of this.inner.issuesByProject.get(id) ?? []) {
        if (seen.has(issue.id)) continue;
        seen.add(issue.id);
        merged.push(issue);
      }
    }
    return filterIssues(merged, query);
  }

  override getIssue(projectId: string, issueId: string): TIssue | undefined {
    const direct = this.inner.issuesByProject.get(projectId)?.find((entry) => entry.id === issueId);
    if (direct) return direct;

    const project = this.inner.projects.find((entry) => entry.id === projectId);
    if (!project) return super.getIssue(projectId, issueId);

    const namesakeIds = this.inner.projects.filter((entry) => entry.name === project.name).map((entry) => entry.id);
    for (const id of namesakeIds) {
      const issue = this.inner.issuesByProject.get(id)?.find((entry) => entry.id === issueId);
      if (issue) return issue;
    }
    return undefined;
  }
}

export function createCacheBackend(db: D1Database | undefined, kv: KVNamespace | undefined): CacheBackend {
  if (db && kv) return new D1KvCacheBackend(db, kv);
  return new MemoryCacheBackend();
}
