import type { KvCacheBackend } from "../cache/backend.js";
import type { Env } from "../env.js";
import { runSync } from "./run-sync.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDebouncedSync(env: Env, cache: KvCacheBackend, reason: string): Promise<void> {
  const debounceMs = env.SYNC_DEBOUNCE_MS;
  const minIntervalMs = env.SYNC_MIN_INTERVAL_MS;

  const scheduledAt = new Date().toISOString();
  await cache.scheduleSyncAt(scheduledAt);

  await sleep(debounceMs);

  const latestScheduledAt = await cache.getScheduledSyncAt();
  if (latestScheduledAt !== scheduledAt) {
    console.log(`[bff] Debounced sync superseded (${reason})`);
    return;
  }

  const lastCompletedAt = await cache.getLastCompletedAt();
  if (lastCompletedAt) {
    const elapsed = Date.now() - Date.parse(lastCompletedAt);
    if (elapsed < minIntervalMs) {
      console.log(`[bff] Sync skipped — min interval not elapsed (${reason})`);
      return;
    }
  }

  await runSync(env, cache, { reason });
}

export function scheduleDebouncedSync(env: Env, cache: KvCacheBackend, ctx: ExecutionContext, reason: string): void {
  ctx.waitUntil(
    runDebouncedSync(env, cache, reason).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[bff] Debounced sync failed (${reason}):`, message);
    })
  );
}
