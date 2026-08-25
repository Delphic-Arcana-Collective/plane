import type { Env } from "../env.js";
import { cacheStore } from "../cache/store.js";
import { fetchLinearSnapshot } from "../linear/client.js";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let syncing = false;

export async function runSync(env: Env, retries = 3): Promise<void> {
  if (!env.LINEAR_API_KEY) {
    console.log("[bff] Skipping Linear sync — no API key configured (Phase 0 mock mode)");
    return;
  }

  if (syncing) {
    console.log("[bff] Sync already in progress, skipping");
    return;
  }

  syncing = true;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < retries) {
    attempt += 1;
    try {
      console.log(`[bff] Syncing from Linear... (attempt ${attempt}/${retries})`);
      // oxlint-disable-next-line eslint/no-await-in-loop -- retries must run sequentially
      const snapshot = await fetchLinearSnapshot(env);
      cacheStore.applySnapshot(snapshot, env);
      const { stats } = cacheStore.cache;
      console.log(
        `[bff] Sync complete: ${stats.projects} projects (${stats.teams} teams), ${stats.issues} issues, ${stats.comments} comments, ${stats.states} states, ${stats.labels} labels`
      );
      syncing = false;
      return;
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
  cacheStore.setError(message);
  syncing = false;
  throw lastError;
}

export function startWorker(env: Env): void {
  if (!env.LINEAR_API_KEY) return;

  const tick = () => {
    runSync(env).catch(() => {
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
