import { Hono } from "hono";
import type { TIssue, TIssueComment, IUserLite } from "@plane/types";
import { EIssueCommentAccessSpecifier } from "@plane/types";
import { createBootstrapContext } from "../bootstrap/session.js";
import { D1KvCacheBackend } from "../cache/d1-kv-backend.js";
import { DATA_SOURCE_LINEAR, DATA_SOURCE_PLANE, TAG_LINEAR, TAG_PLANE } from "../db/constants.js";
import { normalizePlaneIssue, pickDefaultStateId } from "../db/serialize.js";
import { getCache, matchWorkspace } from "./helpers.js";

function isD1Backend(cache: unknown): cache is D1KvCacheBackend {
  return cache instanceof D1KvCacheBackend;
}

type IssueSourceMeta = TIssue & { tag?: string; system_tag?: string; source?: string };
type CommentSourceMeta = TIssueComment & { tag?: string; system_tag?: string; source?: string };

function isLinearProtectedIssue(issue: IssueSourceMeta | undefined): boolean {
  if (!issue) return false;
  return issue.tag === TAG_LINEAR || issue.system_tag === TAG_LINEAR || issue.source === DATA_SOURCE_LINEAR;
}

function isLinearProtectedComment(comment: CommentSourceMeta | undefined): boolean {
  if (!comment) return false;
  return (
    comment.external_source === DATA_SOURCE_LINEAR ||
    comment.tag === TAG_LINEAR ||
    comment.system_tag === TAG_LINEAR ||
    comment.source === DATA_SOURCE_LINEAR
  );
}

/** Strip client-supplied source/tag fields — server owns Linear/Plane tagging. */
function stripSourceFields<T extends object>(body: T): Omit<T, "source" | "system_tag" | "tag"> {
  const {
    source: _source,
    system_tag: _systemTag,
    tag: _tag,
    ...safe
  } = body as T & { source?: string; system_tag?: string; tag?: string };
  return safe;
}

function viewerAsActor(env: Parameters<typeof createBootstrapContext>[0]): IUserLite {
  const bootstrap = createBootstrapContext(env);
  return {
    id: bootstrap.viewer.id,
    first_name: bootstrap.viewer.first_name,
    last_name: bootstrap.viewer.last_name,
    avatar_url: bootstrap.viewer.avatar_url,
    is_bot: bootstrap.viewer.is_bot,
    display_name: bootstrap.viewer.display_name,
  };
}

function buildPlaneComment(params: {
  id: string;
  body: Partial<TIssueComment>;
  issue: TIssue;
  project: { id: string; name: string; identifier?: string };
  workspace: { id: string; name: string; slug: string };
  actor: IUserLite;
  existing?: TIssueComment;
}): TIssueComment {
  const now = new Date().toISOString();
  const html = params.body.comment_html ?? params.existing?.comment_html ?? "<p></p>";
  const stripped =
    params.body.comment_stripped ?? params.existing?.comment_stripped ?? html.replace(/<[^>]+>/g, "").trim();

  return {
    id: params.id,
    workspace: params.workspace.id,
    workspace_detail: {
      id: params.workspace.id,
      name: params.workspace.name,
      slug: params.workspace.slug,
    },
    project: params.project.id,
    project_detail: {
      id: params.project.id,
      identifier: params.project.identifier ?? "",
      name: params.project.name,
      cover_image: "",
      description: "",
      emoji: null,
      icon_prop: null,
    },
    issue: params.issue.id,
    issue_detail: {
      id: params.issue.id,
      sequence_id: params.issue.sequence_id,
      sort_order: false as unknown as boolean,
      name: params.issue.name,
      description_html: params.issue.description_html ?? "",
      priority: params.issue.priority ?? "none",
      start_date: params.issue.start_date ?? "",
      target_date: params.issue.target_date ?? "",
      is_draft: false,
    },
    actor: params.actor.id,
    actor_detail: {
      id: params.actor.id,
      first_name: params.actor.first_name,
      last_name: params.actor.last_name,
      avatar_url: params.actor.avatar_url,
      is_bot: params.actor.is_bot ?? false,
      display_name: params.actor.display_name,
    },
    created_at: params.existing?.created_at ?? now,
    updated_at: now,
    edited_at: params.existing ? now : undefined,
    created_by: params.existing?.created_by ?? params.actor.id,
    updated_by: params.actor.id,
    attachments: params.body.attachments ?? params.existing?.attachments ?? [],
    comment_reactions: params.existing?.comment_reactions ?? [],
    comment_stripped: stripped,
    comment_html: html,
    comment_json: params.body.comment_json ?? params.existing?.comment_json ?? { type: "doc", content: [] },
    external_id: params.id,
    external_source: DATA_SOURCE_PLANE,
    access: params.body.access ?? params.existing?.access ?? EIssueCommentAccessSpecifier.INTERNAL,
    parent:
      (params.body as TIssueComment & { parent?: string | null }).parent ??
      (params.existing as (TIssueComment & { parent?: string | null }) | undefined)?.parent ??
      null,
    source: DATA_SOURCE_PLANE,
    system_tag: TAG_PLANE,
    tag: TAG_PLANE,
  } as TIssueComment;
}

export function createPlaneWriteRoutes() {
  const app = new Hono();

  app.post("/api/workspaces/:slug/projects/:projectId/issues/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const cache = getCache(c);
    if (!isD1Backend(cache)) return c.json({ error: "D1 storage not configured" }, 503);

    const project = cache.cache.projects.find((entry) => entry.id === c.req.param("projectId"));
    if (!project) return c.json({ error: "Not found" }, 404);

    const body = stripSourceFields((await c.req.json()) as Partial<TIssue>);
    const existingIssues = cache.getProjectIssues(project.id);
    const maxSequence = existingIssues.reduce((max, issue) => Math.max(max, issue.sequence_id ?? 0), 0);
    const states = await cache.getProjectStates(project.id);
    const defaultStateId = pickDefaultStateId(states);
    const now = new Date().toISOString();
    const issueId = crypto.randomUUID();
    const actor = viewerAsActor(c.get("env"));

    const created = normalizePlaneIssue(
      {
        id: issueId,
        name: body.name ?? "Untitled",
        description_html: body.description_html,
        priority: body.priority,
        state_id: body.state_id ?? defaultStateId,
        sequence_id: maxSequence + 1,
        sort_order: body.sort_order ?? maxSequence + 1,
        label_ids: body.label_ids,
        assignee_ids: body.assignee_ids,
        estimate_point: body.estimate_point ?? null,
        sub_issues_count: 0,
        attachment_count: 0,
        link_count: 0,
        project_id: project.id,
        parent_id: body.parent_id ?? null,
        cycle_id: body.cycle_id ?? null,
        module_ids: body.module_ids ?? null,
        type_id: body.type_id ?? null,
        created_at: now,
        updated_at: now,
        start_date: body.start_date ?? null,
        target_date: body.target_date ?? null,
        completed_at: null,
        archived_at: null,
        created_by: actor.id,
        updated_by: actor.id,
        is_draft: body.is_draft ?? false,
      } as TIssue,
      { defaultStateId, defaultSequenceId: maxSequence + 1, fallbackTimestamp: now }
    );

    await cache.upsertPlaneIssue(created, project.name);
    await cache.ensureLoaded();
    const saved = cache.getIssue(project.id, issueId) ?? {
      ...created,
      source: DATA_SOURCE_PLANE,
      system_tag: TAG_PLANE,
      tag: TAG_PLANE,
    };
    return c.json(saved, 201);
  });

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
    const states = await cache.getProjectStates(project.id);
    const defaultStateId = pickDefaultStateId(states);
    const merged = normalizePlaneIssue(
      {
        ...(existing ?? { id: issueId, project_id: project.id }),
        ...body,
        id: issueId,
        project_id: project.id,
        created_at: body.created_at ?? existing?.created_at ?? now,
        updated_at: now,
      } as TIssue,
      { defaultStateId, fallbackTimestamp: now }
    );

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
      source: DATA_SOURCE_PLANE,
      system_tag: TAG_PLANE,
      tag: TAG_PLANE,
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

  app.post("/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const cache = getCache(c);
    if (!isD1Backend(cache)) return c.json({ error: "D1 storage not configured" }, 503);

    const projectId = c.req.param("projectId");
    const issueId = c.req.param("issueId");
    const project = cache.cache.projects.find((entry) => entry.id === projectId);
    if (!project) return c.json({ error: "Not found" }, 404);

    const issue = cache.getIssue(projectId, issueId) as IssueSourceMeta | undefined;
    if (!issue) return c.json({ error: "Not found" }, 404);
    if (isLinearProtectedIssue(issue)) {
      return c.json({ error: "Linear issues are read-only" }, 403);
    }

    const body = stripSourceFields((await c.req.json()) as Partial<TIssueComment>);
    const env = c.get("env");
    const bootstrap = createBootstrapContext(env);
    const actor = viewerAsActor(env);
    const commentId = crypto.randomUUID();
    const comment = buildPlaneComment({
      id: commentId,
      body,
      issue,
      project,
      workspace: {
        id: bootstrap.workspace.id,
        name: bootstrap.workspace.name,
        slug: bootstrap.workspace.slug,
      },
      actor,
    });

    await cache.upsertPlaneComment(comment, issueId);
    await cache.ensureLoaded();
    const saved = cache.getIssueComment(issueId, commentId) ?? comment;
    return c.json(saved, 201);
  });

  app.patch("/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments/:commentId/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const cache = getCache(c);
    if (!isD1Backend(cache)) return c.json({ error: "D1 storage not configured" }, 503);

    const projectId = c.req.param("projectId");
    const issueId = c.req.param("issueId");
    const commentId = c.req.param("commentId");
    const project = cache.cache.projects.find((entry) => entry.id === projectId);
    if (!project) return c.json({ error: "Not found" }, 404);

    const issue = cache.getIssue(projectId, issueId) as IssueSourceMeta | undefined;
    if (!issue) return c.json({ error: "Not found" }, 404);
    if (isLinearProtectedIssue(issue)) {
      return c.json({ error: "Linear issues are read-only" }, 403);
    }

    const existing = cache.getIssueComment(issueId, commentId) as CommentSourceMeta | undefined;
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (isLinearProtectedComment(existing)) {
      return c.json({ error: "Linear comments are read-only" }, 403);
    }

    const body = stripSourceFields((await c.req.json()) as Partial<TIssueComment>);
    const env = c.get("env");
    const bootstrap = createBootstrapContext(env);
    const actor = viewerAsActor(env);
    const comment = buildPlaneComment({
      id: commentId,
      body,
      issue,
      project,
      workspace: {
        id: bootstrap.workspace.id,
        name: bootstrap.workspace.name,
        slug: bootstrap.workspace.slug,
      },
      actor,
      existing,
    });

    try {
      await cache.upsertPlaneComment(comment, issueId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Linear-tagged")) {
        return c.json({ error: "Linear comments are read-only" }, 403);
      }
      throw error;
    }
    await cache.ensureLoaded();
    const saved = cache.getIssueComment(issueId, commentId) ?? comment;
    return c.json(saved);
  });

  app.delete("/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments/:commentId/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const cache = getCache(c);
    if (!isD1Backend(cache)) return c.json({ error: "D1 storage not configured" }, 503);

    const projectId = c.req.param("projectId");
    const issueId = c.req.param("issueId");
    const commentId = c.req.param("commentId");

    const issue = cache.getIssue(projectId, issueId) as IssueSourceMeta | undefined;
    if (!issue) return c.json({ error: "Not found" }, 404);
    if (isLinearProtectedIssue(issue)) {
      return c.json({ error: "Linear issues are read-only" }, 403);
    }

    const existing = cache.getIssueComment(issueId, commentId) as CommentSourceMeta | undefined;
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (isLinearProtectedComment(existing)) {
      return c.json({ error: "Linear comments are read-only" }, 403);
    }

    const deleted = await cache.deletePlaneComment(commentId);
    if (!deleted) return c.json({ error: "Linear comments are read-only" }, 403);
    await cache.ensureLoaded();
    return c.body(null, 204);
  });

  /** Gantt / waterfall date updates — Plane issues only; Linear-protected rows are skipped. */
  app.post("/api/workspaces/:slug/projects/:projectId/issue-dates/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const cache = getCache(c);
    if (!isD1Backend(cache)) return c.json({ error: "D1 storage not configured" }, 503);

    const projectId = c.req.param("projectId");
    const project = cache.cache.projects.find((entry) => entry.id === projectId);
    if (!project) return c.json({ error: "Not found" }, 404);

    const body = (await c.req.json()) as {
      updates?: { id: string; start_date?: string | null; target_date?: string | null }[];
    };
    const updates = body.updates ?? [];
    if (updates.length === 0) return c.json({ updated: 0 });

    const states = await cache.getProjectStates(projectId);
    const defaultStateId = pickDefaultStateId(states);
    const now = new Date().toISOString();

    const results = await Promise.all(
      updates.map(async (update) => {
        const existing = cache.getIssue(projectId, update.id) as IssueSourceMeta | undefined;
        if (!existing || isLinearProtectedIssue(existing)) return false;

        const merged = normalizePlaneIssue(
          {
            ...existing,
            start_date: update.start_date !== undefined ? update.start_date : existing.start_date,
            target_date: update.target_date !== undefined ? update.target_date : existing.target_date,
            updated_at: now,
          } as TIssue,
          { defaultStateId, fallbackTimestamp: now }
        );

        try {
          await cache.upsertPlaneIssue(merged, project.name);
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("Linear-tagged")) return false;
          throw error;
        }
      })
    );

    await cache.ensureLoaded();
    return c.json({ updated: results.filter(Boolean).length });
  });

  return app;
}
