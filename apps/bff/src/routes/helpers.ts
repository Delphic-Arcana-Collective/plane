import type { Context } from "hono";
import type { TIssue } from "@plane/types";
import type { CacheBackend } from "../cache/backend.js";
import type { Env } from "../env.js";
import { buildIssuesResponse } from "../mapper/index.js";
import { runSync } from "../sync/run-sync.js";

export function getCache(c: Context): CacheBackend {
  return c.get("cache");
}

export function buildProjectIssuesResponse(issues: TIssue[], query: Record<string, string | undefined>) {
  return buildIssuesResponse(issues, query.group_by ?? null, query.sub_group_by ?? null);
}

export async function requireCache(c: Context): Promise<Response | null> {
  const env = c.get("env");
  const cache = getCache(c);
  await cache.ensureLoaded();

  if (!cache.cache.ready && env.LINEAR_API_KEY) {
    if (env.SYNC_ON_CACHE_MISS) {
      await runSync(env, cache, { reason: "cache-miss" });
      await cache.ensureLoaded();
      if (cache.cache.ready) return null;
    }
    return c.json({ error: "Cache not ready", retry_after: 5 }, 503, {
      "Retry-After": "5",
    });
  }
  return null;
}

export function getWorkspaceSlug(env: Env): string {
  return env.PLANE_WORKSPACE_SLUG;
}

export function matchWorkspace(c: Context, slug: string): boolean {
  return slug === getWorkspaceSlug(c.get("env"));
}
