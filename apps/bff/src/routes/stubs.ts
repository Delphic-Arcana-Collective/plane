import { Hono } from "hono";
import { cacheStore } from "../cache/store.js";
import { getProjectUserProperties, updateProjectUserProperties } from "../cache/user-properties.js";
import { buildProjectIssuesResponse, matchWorkspace, requireCache } from "./helpers.js";
import { createBootstrapContext, BFF_VIEWER_USER_ID } from "../bootstrap/session.js";
import {
  EMPTY_ISSUE_META,
  EMPTY_NOTIFICATION_COUNT,
  EMPTY_NOTIFICATION_PAGE,
  HOME_WIDGETS,
} from "../defaults/empty-responses.js";

function workspaceGuard(c: Parameters<typeof matchWorkspace>[0], slug: string) {
  if (!matchWorkspace(c, slug)) return c.json({ error: "Not found" }, 404);
  return null;
}

function projectMembers(_projectId: string) {
  const users = [...cacheStore.cache.users.values()];
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

  app.get("/api/workspaces/:slug/issues/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = requireCache(c);
    if (cacheBlocked) return cacheBlocked;
    const query = c.req.query();
    const issues = cacheStore.getWorkspaceIssues(query);
    return c.json(buildProjectIssuesResponse(issues, query));
  });

  app.get("/api/workspaces/:slug/issues-detail/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = requireCache(c);
    if (cacheBlocked) return cacheBlocked;
    const query = c.req.query();
    const issues = cacheStore.getWorkspaceIssues(query);
    return c.json(buildProjectIssuesResponse(issues, query));
  });

  app.get("/api/workspaces/:slug/user-issues/:userId/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = requireCache(c);
    if (cacheBlocked) return cacheBlocked;
    const query = c.req.query();
    const issues = cacheStore.getUserIssues(c.req.param("userId"), query);
    return c.json(buildProjectIssuesResponse(issues, query));
  });

  app.get("/api/workspaces/:slug/user-stats/:userId/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    return c.json({
      assigned_issues: cacheStore.getAllIssues().length,
      completed_issues: 0,
      created_issues: cacheStore.getAllIssues().length,
      pending_issues: cacheStore.getAllIssues().length,
      priority_distribution: [],
      state_distribution: [],
    });
  });

  app.get("/api/workspaces/:slug/user-profile/:userId/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    return c.json({
      project_data: cacheStore.cache.projects.map((project) => ({
        id: project.id,
        name: project.name,
        identifier: project.identifier,
        assigned_issues: cacheStore.getProjectIssues(project.id).length,
        completed_issues: 0,
        created_issues: cacheStore.getProjectIssues(project.id).length,
        pending_issues: cacheStore.getProjectIssues(project.id).length,
      })),
    });
  });

  app.get("/api/workspaces/:slug/projects/:projectId/user-properties/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    return c.json(getProjectUserProperties(c.req.param("projectId")));
  });

  app.patch("/api/workspaces/:slug/projects/:projectId/user-properties/", async (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const body = await c.req.json();
    return c.json(updateProjectUserProperties(c.req.param("projectId"), body));
  });

  app.get("/api/workspaces/:slug/projects/:projectId/members/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    return c.json(projectMembers(c.req.param("projectId")));
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

  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/history/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = requireCache(c);
    if (cacheBlocked) return cacheBlocked;

    const activityType = c.req.query("activity_type");
    if (activityType === "issue-property") return c.json([]);

    const comments = cacheStore.getIssueComments(
      c.req.param("projectId"),
      c.req.param("issueId"),
      c.req.query("created_at__gt")
    );
    return c.json(comments);
  });

  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = requireCache(c);
    if (cacheBlocked) return cacheBlocked;

    return c.json(
      cacheStore.getIssueComments(c.req.param("projectId"), c.req.param("issueId"), c.req.query("created_at__gt"))
    );
  });
  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/issue-links/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/sub-issues/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/reactions/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/subscribe/", (c) => c.json({ subscribed: false }));
  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/meta/", (c) => c.json(EMPTY_ISSUE_META));

  app.get("/api/workspaces/:slug/work-items/:identifier/", (c) => {
    const blocked = workspaceGuard(c, c.req.param("slug"));
    if (blocked) return blocked;
    const cacheBlocked = requireCache(c);
    if (cacheBlocked) return cacheBlocked;
    const found = cacheStore.findIssueByIdentifier(c.req.param("identifier"));
    if (!found) return c.json({ error: "Not found" }, 404);
    return c.json(found.issue);
  });

  app.get("/api/assets/v2/workspaces/:slug/projects/:projectId/issues/:issueId/attachments/", (c) => c.json([]));

  app.get("/api/workspaces/:slug/quick-links/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/recent-visits/", (c) => c.json([]));

  return app;
}
