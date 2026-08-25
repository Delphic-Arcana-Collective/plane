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

function logKvError(operation: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[bff] KV ${operation} failed (continuing without cache):`, message);
}

export class KvCacheBackend extends MemoryCacheBackend implements KvCacheBackendInterface {
  private loaded = false;
  private loadedAt: string | null = null;

  constructor(private readonly kv: KVNamespace) {
    super();
  }

  private async kvGet(key: string): Promise<string | null> {
    try {
      return await this.kv.get(key);
    } catch (error) {
      logKvError(`read ${key}`, error);
      return null;
    }
  }

  private async kvPut(key: string, value: string, options?: KVNamespacePutOptions): Promise<boolean> {
    try {
      await this.kv.put(key, value, options);
      return true;
    } catch (error) {
      logKvError(`write ${key}`, error);
      return false;
    }
  }

  private async kvDelete(key: string): Promise<void> {
    try {
      await this.kv.delete(key);
    } catch (error) {
      logKvError(`delete ${key}`, error);
    }
  }

  override async ensureLoaded(): Promise<void> {
    if (this.loaded && this.loadedAt === this.cache.lastFetchedAt) return;

    try {
      const snapshotRaw = await this.kvGet(KV_KEYS.snapshot);
      if (snapshotRaw) {
        try {
          const snapshot = deserializePlaneCache(snapshotRaw);
          this.replaceCache(snapshot);
          this.loaded = true;
          this.loadedAt = snapshot.lastFetchedAt;
          return;
        } catch (error) {
          logKvError("deserialize snapshot", error);
        }
      }

      const metaRaw = await this.kvGet(KV_KEYS.meta);
      if (!metaRaw) {
        this.loaded = true;
        this.loadedAt = null;
        return;
      }

      let meta: ReturnType<typeof deserializeCacheMeta>;
      try {
        meta = deserializeCacheMeta(metaRaw);
      } catch (error) {
        logKvError("deserialize meta", error);
        this.loaded = true;
        this.loadedAt = null;
        return;
      }

      if (this.loaded && this.loadedAt === meta.lastFetchedAt) return;

      await this.loadLegacyShards(meta);
    } catch (error) {
      logKvError("ensureLoaded", error);
      this.loaded = true;
      this.loadedAt = this.cache.lastFetchedAt;
    }
  }

  private async loadLegacyShards(meta: ReturnType<typeof deserializeCacheMeta>): Promise<void> {
    const [workspaceRaw, projectsRaw, statesRaw, labelsRaw, issuesRaw, commentsRaw, usersRaw] = await Promise.all([
      this.kvGet(KV_KEYS.workspace),
      this.kvGet(KV_KEYS.projects),
      this.kvGet(KV_KEYS.states),
      this.kvGet(KV_KEYS.labels),
      this.kvGet(KV_KEYS.issues),
      this.kvGet(KV_KEYS.comments),
      this.kvGet(KV_KEYS.users),
    ]);

    try {
      const workspace = workspaceRaw
        ? (JSON.parse(workspaceRaw) as ReturnType<typeof assemblePlaneCache>["workspace"])
        : null;
      const projects = projectsRaw
        ? (JSON.parse(projectsRaw) as ReturnType<typeof assemblePlaneCache>["projects"])
        : [];

      this.replaceCache(
        assemblePlaneCache(meta, workspace, projects, statesRaw, labelsRaw, issuesRaw, commentsRaw, usersRaw)
      );
      this.loaded = true;
      this.loadedAt = meta.lastFetchedAt;

      if (this.cache.ready) {
        await this.persistSnapshot();
      }
    } catch (error) {
      logKvError("load legacy shards", error);
      this.loaded = true;
      this.loadedAt = null;
    }
  }

  private async persistSnapshot(): Promise<boolean> {
    const cache = this.cache;
    const snapshotBlob = serializePlaneCache(cache);

    const snapshotWritten = await this.kvPut(KV_KEYS.snapshot, snapshotBlob);
    const metaWritten = await this.kvPut(KV_KEYS.meta, serializeCacheMeta(cache));
    await Promise.all(LEGACY_KV_KEYS.map((key) => this.kvDelete(key)));

    if (snapshotWritten && metaWritten) {
      this.loaded = true;
      this.loadedAt = cache.lastFetchedAt;
      return true;
    }

    return false;
  }

  override async applySnapshot(snapshot: Parameters<CacheBackend["applySnapshot"]>[0], env: Env): Promise<void> {
    await super.applySnapshot(snapshot, env);

    const persisted = await this.persistSnapshot();
    if (persisted) {
      await this.kvPut(SYNC_LAST_COMPLETED_AT_KEY, new Date().toISOString());
    }

    this.loaded = true;
    this.loadedAt = this.cache.lastFetchedAt;
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
      this.kvDelete(KV_KEYS.meta),
      this.kvDelete(KV_KEYS.snapshot),
      ...LEGACY_KV_KEYS.map((key) => this.kvDelete(key)),
    ]);
  }

  override async getProjectUserProperties(projectId: string): Promise<IProjectUserPropertiesResponse> {
    const stored = await this.kvGet(getProjectUserPropertiesKey(projectId));
    if (!stored) return structuredClone(EMPTY_PROJECT_USER_PROPERTIES);
    try {
      return JSON.parse(stored) as IProjectUserPropertiesResponse;
    } catch (error) {
      logKvError(`parse user-properties ${projectId}`, error);
      return structuredClone(EMPTY_PROJECT_USER_PROPERTIES);
    }
  }

  override async updateProjectUserProperties(
    projectId: string,
    patch: Partial<IProjectUserPropertiesResponse>
  ): Promise<IProjectUserPropertiesResponse> {
    const current = await this.getProjectUserProperties(projectId);
    const next = mergeProjectUserProperties(current, patch);
    await this.kvPut(getProjectUserPropertiesKey(projectId), JSON.stringify(next));
    return next;
  }

  override async tryAcquireSyncLock(): Promise<boolean> {
    try {
      const existing = await this.kv.get(SYNC_IN_PROGRESS_KEY);
      if (existing) return false;
      await this.kv.put(SYNC_IN_PROGRESS_KEY, "1", { expirationTtl: 300 });
      return true;
    } catch (error) {
      logKvError("acquire sync lock", error);
      return true;
    }
  }

  override async releaseSyncLock(): Promise<void> {
    await this.kvDelete(SYNC_IN_PROGRESS_KEY);
  }

  async markWebhookDeliveryProcessed(deliveryId: string): Promise<boolean> {
    const key = `${WEBHOOK_DELIVERY_PREFIX}${deliveryId}`;
    const existing = await this.kvGet(key);
    if (existing) return false;
    await this.kvPut(key, "1", { expirationTtl: 86_400 });
    return true;
  }

  async scheduleSyncAt(isoTimestamp: string): Promise<void> {
    await this.kvPut(SYNC_SCHEDULED_AT_KEY, isoTimestamp);
  }

  async getScheduledSyncAt(): Promise<string | null> {
    return this.kvGet(SYNC_SCHEDULED_AT_KEY);
  }

  async getLastCompletedAt(): Promise<string | null> {
    return this.kvGet(SYNC_LAST_COMPLETED_AT_KEY);
  }

  async isSyncInProgress(): Promise<boolean> {
    const value = await this.kvGet(SYNC_IN_PROGRESS_KEY);
    return value !== null;
  }
}
