import type { Env } from "../env.js";
import type { CacheBackend } from "../cache/backend.js";
import { runSync as runSyncCore, type RunSyncOptions } from "../sync/run-sync.js";

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export async function runSync(env: Env, cache: CacheBackend, retries = 3): Promise<void> {
  return runSyncCore(env, cache, { retries, reason: "node-poll" });
}

export function startWorker(env: Env, cache: CacheBackend): void {
  if (!env.LINEAR_API_KEY) return;

  const tick = () => {
    runSync(env, cache).catch(() => {
      // logged in runSync
    });
  };

  if (env.CACHE_INITIAL_FETCH) {
    tick();
  }

  intervalHandle = setInterval(tick, env.CACHE_POLL_INTERVAL_MS ?? 15_000);
  console.log(`[bff] Worker started (interval ${env.CACHE_POLL_INTERVAL_MS ?? 15_000}ms)`);
}

export function stopWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export type { RunSyncOptions };
