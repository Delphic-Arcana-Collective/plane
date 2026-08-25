import type { Context } from "hono";
import type { TIssue } from "@plane/types";
import type { Env } from "../env.js";
import { cacheStore } from "../cache/store.js";
import { buildIssuesResponse } from "../mapper/index.js";

export function buildProjectIssuesResponse(issues: TIssue[], query: Record<string, string | undefined>) {
  return buildIssuesResponse(issues, query.group_by ?? null, query.sub_group_by ?? null);
}

export function requireCache(c: Context) {
  if (!cacheStore.cache.ready && c.get("env").LINEAR_API_KEY) {
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
