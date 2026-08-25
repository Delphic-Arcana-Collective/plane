import { Hono } from "hono";
import type { Env } from "../env.js";
import { cacheStore } from "../cache/store.js";
import { createBootstrapContext } from "../bootstrap/session.js";
import { matchWorkspace, requireCache, buildProjectIssuesResponse } from "./helpers.js";

export function createProjectRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/projects/", (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = requireCache(c);
    if (blocked) return blocked;
    if (cacheStore.cache.ready) return c.json(cacheStore.cache.projects);
    return c.json([]);
  });

  app.get("/api/workspaces/:slug/projects/details/", (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = requireCache(c);
    if (blocked) return blocked;
    return c.json(cacheStore.cache.projects);
  });

  app.get("/api/workspaces/:slug/projects/:projectId/", (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = requireCache(c);
    if (blocked) return blocked;
    const project = cacheStore.cache.projects.find((p) => p.id === c.req.param("projectId"));
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  });

  return app;
}

export function createStateRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/states/", (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = requireCache(c);
    if (blocked) return blocked;
    return c.json(cacheStore.getWorkspaceStates());
  });

  app.get("/api/workspaces/:slug/projects/:projectId/states/", (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = requireCache(c);
    if (blocked) return blocked;
    const states = cacheStore.cache.statesByProject.get(c.req.param("projectId")) ?? [];
    return c.json(states);
  });

  return app;
}

export function createLabelRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/projects/:projectId/issue-labels/", (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = requireCache(c);
    if (blocked) return blocked;
    const labels = cacheStore.cache.labelsByProject.get(c.req.param("projectId")) ?? [];
    return c.json(labels);
  });

  app.get("/api/workspaces/:slug/labels/", (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = requireCache(c);
    if (blocked) return blocked;
    return c.json([...cacheStore.cache.labelsByProject.values()].flat());
  });

  return app;
}

export function createIssueRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/projects/:projectId/issues/", (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = requireCache(c);
    if (blocked) return blocked;
    const projectId = c.req.param("projectId");
    const query = c.req.query();
    const issues = cacheStore.getProjectIssues(projectId, query);
    return c.json(buildProjectIssuesResponse(issues, query));
  });

  app.get("/api/workspaces/:slug/projects/:projectId/issues-detail/", (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = requireCache(c);
    if (blocked) return blocked;
    const projectId = c.req.param("projectId");
    const query = c.req.query();
    const issues = cacheStore.getProjectIssues(projectId, query);
    return c.json(buildProjectIssuesResponse(issues, query));
  });

  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/", (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = requireCache(c);
    if (blocked) return blocked;
    const issue = cacheStore.getIssue(c.req.param("projectId"), c.req.param("issueId"));
    if (!issue) return c.json({ error: "Not found" }, 404);
    return c.json(issue);
  });

  return app;
}

export function createDataWorkspaceRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/", (c) => {
    const env = c.get("env") as Env;
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);

    if (cacheStore.cache.ready && cacheStore.cache.workspace) {
      return c.json(cacheStore.cache.workspace);
    }

    const bootstrap = createBootstrapContext(env);
    return c.json(bootstrap.workspace);
  });

  return app;
}

export function createDataUserWorkspaceRoutes() {
  const app = new Hono();

  app.get("/api/users/me/workspaces/", (c) => {
    const env = c.get("env") as Env;
    if (cacheStore.cache.ready && cacheStore.cache.workspace) {
      const ws = cacheStore.cache.workspace;
      return c.json([
        {
          id: ws.id,
          name: ws.name,
          slug: ws.slug,
          logo_url: ws.logo_url,
          role: 20,
          total_members: ws.total_members,
          total_projects: cacheStore.cache.projects.length,
        },
      ]);
    }
    const bootstrap = createBootstrapContext(env);
    return c.json([bootstrap.workspaceListItem]);
  });

  return app;
}
