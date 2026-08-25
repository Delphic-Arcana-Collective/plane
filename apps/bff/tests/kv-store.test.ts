import { describe, expect, it } from "vitest";
import { KvCacheBackend } from "../src/cache/kv-store.js";
import { KV_KEYS, deserializePlaneCache, serializeCacheMeta } from "../src/cache/serialization.js";
import { buildPlaneCacheFromSnapshot } from "../src/cache/snapshot.js";
import { createTestEnv, createTestSnapshot } from "./test-utils.js";

class MockKVNamespace implements KVNamespace {
  private readonly store = new Map<string, string>();
  failGet = false;
  failPut = false;

  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error("kv read failed");
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    if (this.failPut) throw new Error("kv write failed");
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<KVNamespaceListResult<unknown>> {
    return { keys: [], list_complete: true, cacheStatus: null };
  }

  async getWithMetadata(): Promise<KVNamespaceGetWithMetadataResult<unknown, unknown>> {
    return { value: null, metadata: null, cacheStatus: null };
  }
}

describe("KvCacheBackend resilience", () => {
  it("treats KV read errors as cache miss", async () => {
    const kv = new MockKVNamespace();
    kv.failGet = true;
    const cache = new KvCacheBackend(kv);

    await cache.ensureLoaded();

    expect(cache.cache.ready).toBe(false);
  });

  it("keeps in-memory snapshot when KV write fails after sync", async () => {
    const kv = new MockKVNamespace();
    const cache = new KvCacheBackend(kv);
    const env = createTestEnv();
    const snapshot = createTestSnapshot();

    kv.failPut = true;
    await cache.applySnapshot(snapshot, env);

    expect(cache.cache.ready).toBe(true);
    expect(cache.cache.issuesByProject.size).toBeGreaterThan(0);
    expect(await kv.get(KV_KEYS.snapshot)).toBeNull();
  });

  it("ignores corrupt snapshot blobs and continues", async () => {
    const kv = new MockKVNamespace();
    await kv.put(KV_KEYS.snapshot, "{not-json");
    const cache = new KvCacheBackend(kv);

    await cache.ensureLoaded();

    expect(cache.cache.ready).toBe(false);
  });

  it("loads valid snapshot even when legacy shard writes fail during migration", async () => {
    const kv = new MockKVNamespace();
    const env = createTestEnv();
    const snapshot = createTestSnapshot();
    const planeCache = buildPlaneCacheFromSnapshot(snapshot, env);

    await kv.put(KV_KEYS.meta, serializeCacheMeta(planeCache));
    await kv.put(KV_KEYS.projects, JSON.stringify(planeCache.projects));
    await kv.put(KV_KEYS.workspace, JSON.stringify(planeCache.workspace));
    await kv.put(KV_KEYS.issues, JSON.stringify(Object.fromEntries(planeCache.issuesByProject.entries())));

    const cache = new KvCacheBackend(kv);
    kv.failPut = true;
    await cache.ensureLoaded();

    expect(cache.cache.ready).toBe(true);
    expect(cache.cache.projects.length).toBeGreaterThan(0);
  });

  it("persists snapshot when KV writes succeed", async () => {
    const kv = new MockKVNamespace();
    const cache = new KvCacheBackend(kv);
    const env = createTestEnv();

    await cache.applySnapshot(createTestSnapshot(), env);

    const snapshotRaw = await kv.get(KV_KEYS.snapshot);
    expect(snapshotRaw).not.toBeNull();
    expect(deserializePlaneCache(snapshotRaw!).ready).toBe(true);
  });
});
