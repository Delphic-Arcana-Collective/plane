import { Hono } from "hono";
import type { CacheBackend } from "../cache/backend.js";
import { createBootstrapContext, BFF_VIEWER_USER_ID } from "../bootstrap/session.js";
import {
  EMPTY_ISSUE_META,
  EMPTY_NOTIFICATION_COUNT,
  EMPTY_NOTIFICATION_PAGE,
  HOME_WIDGETS,
} from "../defaults/empty-responses.js";
import { buildProjectIssuesResponse, getCache, matchWorkspace, requireCache } from "./helpers.js";

function workspaceGuard(c: Parameters<typeof matchWorkspace>[0], slug: string) {
  if (!matchWorkspace(c, slug)) return c.json({ error: "Not found" }, 404);
  return null;
}

function projectMembers(cache: CacheBackend, _projectId: string) {
  const users = [...cache.cache.users.values()];
  if (users.length === 0) {
    return [
      {
        id: "member-mock",
        member: BFF_VIEWER_USER_ID,
        role: 20,
        original_role: 20,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
  }

  return users.map((user, index) => ({
    id: `member-${index}`,
    member: user.id,
    role: 20,
    original_role: 20,
    created_at: "2026-01-01T00:00:00.000Z",
  }));
}

export function createStubRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/users/notifications/unread/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    return c.json(EMPTY_NOTIFICATION_COUNT);
  });

  app.get("/api/workspaces/:slug/users/notifications/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    return c.json(EMPTY_NOTIFICATION_PAGE);
  });

  app.get("/api/workspaces/:slug/home-preferences/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    return c.json(HOME_WIDGETS);
  });

  app.get("/api/workspaces/:slug/issues/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = await requireCache(c);
    if (cacheBlocked) return cacheBlocked;
    const query = c.req.query();
    const issues = getCache(c).getWorkspaceIssues(query);
    return c.json(buildProjectIssuesResponse(issues, query));
  });

  app.get("/api/workspaces/:slug/issues-detail/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = await requireCache(c);
    if (cacheBlocked) return cacheBlocked;
    const query = c.req.query();
    const issues = getCache(c).getWorkspaceIssues(query);
    return c.json(buildProjectIssuesResponse(issues, query));
  });

  app.get("/api/workspaces/:slug/user-issues/:userId/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = await requireCache(c);
    if (cacheBlocked) return cacheBlocked;
    const query = c.req.query();
    const issues = getCache(c).getUserIssues(c.req.param("userId"), query);
    return c.json(buildProjectIssuesResponse(issues, query));
  });

  app.get("/api/workspaces/:slug/user-stats/:userId/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const allIssues = getCache(c).getAllIssues();
    return c.json({
      assigned_issues: allIssues.length,
      completed_issues: 0,
      created_issues: allIssues.length,
      pending_issues: allIssues.length,
      priority_distribution: [],
      state_distribution: [],
    });
  });

  app.get("/api/workspaces/:slug/user-profile/:userId/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cache = getCache(c);
    return c.json({
      project_data: cache.cache.projects.map((project) => ({
        id: project.id,
        name: project.name,
        identifier: project.identifier,
        assigned_issues: cache.getProjectIssues(project.id).length,
        completed_issues: 0,
        created_issues: cache.getProjectIssues(project.id).length,
        pending_issues: cache.getProjectIssues(project.id).length,
      })),
    });
  });

  app.get("/api/workspaces/:slug/projects/:projectId/user-properties/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    return c.json(await getCache(c).getProjectUserProperties(c.req.param("projectId")));
  });

  app.patch("/api/workspaces/:slug/projects/:projectId/user-properties/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const body = await c.req.json();
    return c.json(await getCache(c).updateProjectUserProperties(c.req.param("projectId"), body));
  });

  app.get("/api/workspaces/:slug/projects/:projectId/members/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    return c.json(projectMembers(getCache(c), c.req.param("projectId")));
  });

  app.get("/api/workspaces/:slug/projects/:projectId/project-members/me/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const bootstrap = createBootstrapContext(c.get("env"));
    return c.json({
      id: "project-member-me",
      member: bootstrap.viewer.id,
      role: 20,
      original_role: 20,
      created_at: "2026-01-01T00:00:00.000Z",
      is_active: true,
      project: c.req.param("projectId"),
      workspace: bootstrap.workspace.id,
    });
  });

  app.get("/api/workspaces/:slug/modules/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/cycles/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/projects/:projectId/cycles/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/projects/:projectId/modules/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/projects/:projectId/views/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/projects/:projectId/estimates/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/projects/:projectId/intake-state/", (c) => c.json(null));

  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/history/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = await requireCache(c);
    if (cacheBlocked) return cacheBlocked;

    const activityType = c.req.query("activity_type");
    if (activityType === "issue-property") return c.json([]);

    const comments = getCache(c).getIssueComments(
      c.req.param("projectId"),
      c.req.param("issueId"),
      c.req.query("created_at__gt")
    );
    return c.json(comments);
  });

  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = await requireCache(c);
    if (cacheBlocked) return cacheBlocked;

    return c.json(
      getCache(c).getIssueComments(c.req.param("projectId"), c.req.param("issueId"), c.req.query("created_at__gt"))
    );
  });
  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/issue-links/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/sub-issues/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/reactions/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/subscribe/", (c) => c.json({ subscribed: false }));
  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/meta/", (c) => c.json(EMPTY_ISSUE_META));

  app.get("/api/workspaces/:slug/work-items/:identifier/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = await requireCache(c);
    if (cacheBlocked) return cacheBlocked;
    const found = getCache(c).findIssueByIdentifier(c.req.param("identifier"));
    if (!found) return c.json({ error: "Not found" }, 404);
    return c.json(found.issue);
  });

  app.get("/api/assets/v2/workspaces/:slug/projects/:projectId/issues/:issueId/attachments/", (c) => c.json([]));

  app.get("/api/workspaces/:slug/quick-links/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/recent-visits/", (c) => c.json([]));

  return app;
}
