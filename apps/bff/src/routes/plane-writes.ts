import { Hono } from "hono";
import type { TIssue } from "@plane/types";
import { D1KvCacheBackend } from "../cache/d1-kv-backend.js";
import { DATA_SOURCE_LINEAR, TAG_LINEAR } from "../db/constants.js";
import { getCache, matchWorkspace } from "./helpers.js";

function isD1Backend(cache: unknown): cache is D1KvCacheBackend {
  return cache instanceof D1KvCacheBackend;
}

type IssueSourceMeta = TIssue & { tag?: string; system_tag?: string; source?: string };

function isLinearProtectedIssue(issue: IssueSourceMeta | undefined): boolean {
  if (!issue) return false;
  return issue.tag === TAG_LINEAR || issue.system_tag === TAG_LINEAR || issue.source === DATA_SOURCE_LINEAR;
}

/** Strip client-supplied source/tag fields — server owns Linear/Plane tagging. */
function stripSourceFields(body: Partial<TIssue>): Partial<TIssue> {
  const {
    source: _source,
    system_tag: _systemTag,
    tag: _tag,
    ...safe
  } = body as Partial<TIssue> & { source?: string; system_tag?: string; tag?: string };
  return safe;
}

export function createPlaneWriteRoutes() {
  const app = new Hono();

  app.patch("/api/workspaces/:slug/projects/:projectId/issues/:issueId/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const cache = getCache(c);
    if (!isD1Backend(cache)) return c.json({ error: "D1 storage not configured" }, 503);

    const issueId = c.req.param("issueId");
    const existing = cache.getIssue(c.req.param("projectId"), issueId) as IssueSourceMeta | undefined;
    if (isLinearProtectedIssue(existing)) {
      return c.json({ error: "Linear issues are read-only" }, 403);
    }

    const body = stripSourceFields((await c.req.json()) as Partial<TIssue>);
    const project = cache.cache.projects.find((entry) => entry.id === c.req.param("projectId"));
    if (!project) return c.json({ error: "Not found" }, 404);

    const now = new Date().toISOString();
    const merged: TIssue = {
      ...(existing ?? { id: issueId, project_id: project.id }),
      ...body,
      id: issueId,
      project_id: project.id,
      created_at: body.created_at ?? existing?.created_at ?? now,
      updated_at: now,
    } as TIssue;

    try {
      await cache.upsertPlaneIssue(merged, project.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Linear-tagged")) {
        return c.json({ error: "Linear issues are read-only" }, 403);
      }
      throw error;
    }
    await cache.ensureLoaded();
    const saved = cache.getIssue(project.id, issueId) ?? {
      ...merged,
      source: "plane",
      system_tag: "Plane",
      tag: "Plane",
    };
    return c.json(saved);
  });

  app.delete("/api/workspaces/:slug/projects/:projectId/issues/:issueId/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const cache = getCache(c);
    if (!isD1Backend(cache)) return c.json({ error: "D1 storage not configured" }, 503);

    const issueId = c.req.param("issueId");
    const existing = cache.getIssue(c.req.param("projectId"), issueId) as IssueSourceMeta | undefined;
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (isLinearProtectedIssue(existing)) {
      return c.json({ error: "Cannot delete Linear-tagged issue" }, 403);
    }

    const deleted = await cache.deletePlaneIssue(issueId);
    if (!deleted) return c.json({ error: "Cannot delete Linear-tagged issue" }, 403);
    await cache.ensureLoaded();
    return c.body(null, 204);
  });

  return app;
}
