import type { IProjectUserPropertiesResponse } from "@plane/types";
import type { Env } from "../env.js";
import type { CacheBackend, KvCacheBackend as KvCacheBackendInterface } from "./backend.js";
import {
  SYNC_IN_PROGRESS_KEY,
  SYNC_LAST_COMPLETED_AT_KEY,
  SYNC_SCHEDULED_AT_KEY,
  WEBHOOK_DELIVERY_PREFIX,
} from "./backend.js";
import {
  assemblePlaneCache,
  deserializeCacheMeta,
  deserializePlaneCache,
  getProjectUserPropertiesKey,
  KV_KEYS,
  mergeProjectUserProperties,
  serializeCacheMeta,
  serializePlaneCache,
} from "./serialization.js";
import { MemoryCacheBackend } from "./store.js";
import { EMPTY_PROJECT_USER_PROPERTIES } from "./user-properties.js";

const LEGACY_KV_KEYS = [
  KV_KEYS.workspace,
  KV_KEYS.projects,
  KV_KEYS.states,
  KV_KEYS.labels,
  KV_KEYS.issues,
  KV_KEYS.comments,
  KV_KEYS.users,
] as const;

export class KvCacheBackend extends MemoryCacheBackend implements KvCacheBackendInterface {
  private loaded = false;
  private loadedAt: string | null = null;

  constructor(private readonly kv: KVNamespace) {
    super();
  }

  override async ensureLoaded(): Promise<void> {
    const snapshotRaw = await this.kv.get(KV_KEYS.snapshot);
    if (snapshotRaw) {
      const snapshot = deserializePlaneCache(snapshotRaw);
      if (this.loaded && this.loadedAt === snapshot.lastFetchedAt) return;

      this.replaceCache(snapshot);
      this.loaded = true;
      this.loadedAt = snapshot.lastFetchedAt;
      return;
    }

    const metaRaw = await this.kv.get(KV_KEYS.meta);
    if (!metaRaw) {
      this.loaded = true;
      this.loadedAt = null;
      return;
    }

    const meta = deserializeCacheMeta(metaRaw);
    if (this.loaded && this.loadedAt === meta.lastFetchedAt) return;

    // Legacy multi-key layout (pre-snapshot): load, then migrate to atomic blob.
    await this.loadLegacyShards(meta);
  }

  private async loadLegacyShards(meta: ReturnType<typeof deserializeCacheMeta>): Promise<void> {
    const [workspaceRaw, projectsRaw, statesRaw, labelsRaw, issuesRaw, commentsRaw, usersRaw] = await Promise.all([
      this.kv.get(KV_KEYS.workspace),
      this.kv.get(KV_KEYS.projects),
      this.kv.get(KV_KEYS.states),
      this.kv.get(KV_KEYS.labels),
      this.kv.get(KV_KEYS.issues),
      this.kv.get(KV_KEYS.comments),
      this.kv.get(KV_KEYS.users),
    ]);

    const workspace = workspaceRaw
      ? (JSON.parse(workspaceRaw) as ReturnType<typeof assemblePlaneCache>["workspace"])
      : null;
    const projects = projectsRaw ? (JSON.parse(projectsRaw) as ReturnType<typeof assemblePlaneCache>["projects"]) : [];

    this.replaceCache(
      assemblePlaneCache(meta, workspace, projects, statesRaw, labelsRaw, issuesRaw, commentsRaw, usersRaw)
    );
    this.loaded = true;
    this.loadedAt = meta.lastFetchedAt;

    if (this.cache.ready) {
      await this.persistSnapshot();
    }
  }

  private async persistSnapshot(): Promise<void> {
    const cache = this.cache;
    const snapshotBlob = serializePlaneCache(cache);

    // 1. Write full snapshot blob (atomic unit for readers).
    await this.kv.put(KV_KEYS.snapshot, snapshotBlob);
    // 2. Publish meta pointer only after snapshot is complete.
    await this.kv.put(KV_KEYS.meta, serializeCacheMeta(cache));
    // 3. Remove legacy shards so nothing reads a mixed generation.
    await Promise.all(LEGACY_KV_KEYS.map((key) => this.kv.delete(key)));

    this.loaded = true;
    this.loadedAt = cache.lastFetchedAt;
  }

  override async applySnapshot(snapshot: Parameters<CacheBackend["applySnapshot"]>[0], env: Env): Promise<void> {
    await super.applySnapshot(snapshot, env);
    await this.persistSnapshot();
    await this.kv.put(SYNC_LAST_COMPLETED_AT_KEY, new Date().toISOString());
  }

  override async setError(message: string): Promise<void> {
    await super.setError(message);
    if (this.loaded) {
      await this.persistSnapshot();
    }
  }

  override async reset(): Promise<void> {
    await super.reset();
    this.loaded = true;
    this.loadedAt = null;
    await Promise.all([
      this.kv.delete(KV_KEYS.meta),
      this.kv.delete(KV_KEYS.snapshot),
      ...LEGACY_KV_KEYS.map((key) => this.kv.delete(key)),
    ]);
  }

  override async getProjectUserProperties(projectId: string): Promise<IProjectUserPropertiesResponse> {
    const stored = await this.kv.get(getProjectUserPropertiesKey(projectId));
    if (!stored) return structuredClone(EMPTY_PROJECT_USER_PROPERTIES);
    return JSON.parse(stored) as IProjectUserPropertiesResponse;
  }

  override async updateProjectUserProperties(
    projectId: string,
    patch: Partial<IProjectUserPropertiesResponse>
  ): Promise<IProjectUserPropertiesResponse> {
    const current = await this.getProjectUserProperties(projectId);
    const next = mergeProjectUserProperties(current, patch);
    await this.kv.put(getProjectUserPropertiesKey(projectId), JSON.stringify(next));
    return next;
  }

  override async tryAcquireSyncLock(): Promise<boolean> {
    const existing = await this.kv.get(SYNC_IN_PROGRESS_KEY);
    if (existing) return false;
    await this.kv.put(SYNC_IN_PROGRESS_KEY, "1", { expirationTtl: 300 });
    return true;
  }

  override async releaseSyncLock(): Promise<void> {
    await this.kv.delete(SYNC_IN_PROGRESS_KEY);
  }

  async markWebhookDeliveryProcessed(deliveryId: string): Promise<boolean> {
    const key = `${WEBHOOK_DELIVERY_PREFIX}${deliveryId}`;
    const existing = await this.kv.get(key);
    if (existing) return false;
    await this.kv.put(key, "1", { expirationTtl: 86_400 });
    return true;
  }

  async scheduleSyncAt(isoTimestamp: string): Promise<void> {
    await this.kv.put(SYNC_SCHEDULED_AT_KEY, isoTimestamp);
  }

  async getScheduledSyncAt(): Promise<string | null> {
    return this.kv.get(SYNC_SCHEDULED_AT_KEY);
  }

  async getLastCompletedAt(): Promise<string | null> {
    return this.kv.get(SYNC_LAST_COMPLETED_AT_KEY);
  }

  async isSyncInProgress(): Promise<boolean> {
    const value = await this.kv.get(SYNC_IN_PROGRESS_KEY);
    return value !== null;
  }
}
