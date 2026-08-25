import type { CacheBackend } from "../cache/backend.js";
import type { Env } from "../env.js";
import { fetchLinearSnapshot } from "../linear/client.js";

export interface RunSyncOptions {
  retries?: number;
  reason?: string;
}

export type RunSyncResult = "completed" | "skipped" | "failed";

export async function runSync(env: Env, cache: CacheBackend, options: RunSyncOptions = {}): Promise<RunSyncResult> {
  const { retries = 3, reason = "manual" } = options;

  if (!env.LINEAR_API_KEY) {
    console.log("[bff] Skipping Linear sync — no API key configured (Phase 0 mock mode)");
    return "skipped";
  }

  const acquired = await cache.tryAcquireSyncLock();
  if (!acquired) {
    console.log(`[bff] Sync already in progress, skipping (${reason})`);
    return "skipped";
  }

  let attempt = 0;
  let lastError: unknown;

  try {
    while (attempt < retries) {
      attempt += 1;
      try {
        console.log(`[bff] Syncing from Linear... (${reason}, attempt ${attempt}/${retries})`);
        // oxlint-disable-next-line eslint/no-await-in-loop -- retries must run sequentially
        const snapshot = await fetchLinearSnapshot(env);
        // oxlint-disable-next-line eslint/no-await-in-loop -- retries must run sequentially
        await cache.applySnapshot(snapshot, env);
        // oxlint-disable-next-line eslint/no-await-in-loop -- retries must run sequentially
        const { stats } = await cache.getMeta();
        console.log(
          `[bff] Sync complete: ${stats.projects} projects (${stats.teams} teams), ${stats.issues} issues, ${stats.comments} comments, ${stats.states} states, ${stats.labels} labels`
        );
        return "completed";
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[bff] Sync attempt ${attempt} failed:`, message);
        if (attempt < retries) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- backoff between retries
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    await cache.setError(message);
    return "failed";
  } finally {
    await cache.releaseSyncLock();
  }
}
