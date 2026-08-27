import type { Env } from "../env.js";
import type { CacheBackend } from "../cache/backend.js";

/**
 * Node/dev entry used to call startWorker from server.ts.
 * Linear data syncs only via webhook or admin POST /internal/sync-linear — no background poll.
 */
export function startWorker(_env: Env, _cache: CacheBackend): void {
  // intentionally empty
}

export function stopWorker(): void {
  // no-op (no interval to clear)
}
