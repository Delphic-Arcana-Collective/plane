import { Hono } from "hono";
import type { Env } from "../env.js";
import { createBootstrapContext } from "../bootstrap/session.js";
import { getCache, matchWorkspace, requireCache, buildProjectIssuesResponse } from "./helpers.js";

export function createProjectRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/projects/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = await requireCache(c);
    if (blocked) return blocked;
    const { cache } = getCache(c);
    if (cache.ready) return c.json(cache.projects);
    return c.json([]);
  });

  app.get("/api/workspaces/:slug/projects/details/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = await requireCache(c);
    if (blocked) return blocked;
    return c.json(getCache(c).cache.projects);
  });

  app.get("/api/workspaces/:slug/projects/:projectId/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = await requireCache(c);
    if (blocked) return blocked;
    const project = getCache(c).cache.projects.find((entry) => entry.id === c.req.param("projectId"));
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  });

  return app;
}

export function createStateRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/states/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = await requireCache(c);
    if (blocked) return blocked;
    return c.json(getCache(c).getWorkspaceStates());
  });

  app.get("/api/workspaces/:slug/projects/:projectId/states/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = await requireCache(c);
    if (blocked) return blocked;
    return c.json(getCache(c).cache.statesByProject.get(c.req.param("projectId")) ?? []);
  });

  return app;
}

export function createLabelRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/projects/:projectId/issue-labels/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = await requireCache(c);
    if (blocked) return blocked;
    return c.json(getCache(c).cache.labelsByProject.get(c.req.param("projectId")) ?? []);
  });

  app.get("/api/workspaces/:slug/labels/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = await requireCache(c);
    if (blocked) return blocked;
    return c.json([...getCache(c).cache.labelsByProject.values()].flat());
  });

  return app;
}

export function createIssueRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/projects/:projectId/issues/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = await requireCache(c);
    if (blocked) return blocked;
    const projectId = c.req.param("projectId");
    const query = c.req.query();
    const issues = getCache(c).getProjectIssues(projectId, query);
    return c.json(buildProjectIssuesResponse(issues, query));
  });

  app.get("/api/workspaces/:slug/projects/:projectId/issues-detail/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = await requireCache(c);
    if (blocked) return blocked;
    const projectId = c.req.param("projectId");
    const query = c.req.query();
    const issues = getCache(c).getProjectIssues(projectId, query);
    return c.json(buildProjectIssuesResponse(issues, query));
  });

  app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/", async (c) => {
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);
    const blocked = await requireCache(c);
    if (blocked) return blocked;
    const issue = getCache(c).getIssue(c.req.param("projectId"), c.req.param("issueId"));
    if (!issue) return c.json({ error: "Not found" }, 404);
    return c.json(issue);
  });

  return app;
}

export function createDataWorkspaceRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/", async (c) => {
    const env = c.get("env") as Env;
    if (!matchWorkspace(c, c.req.param("slug"))) return c.json({ error: "Not found" }, 404);

    const { cache } = getCache(c);
    if (cache.ready && cache.workspace) {
      return c.json(cache.workspace);
    }

    const bootstrap = createBootstrapContext(env);
    return c.json(bootstrap.workspace);
  });

  return app;
}

export function createDataUserWorkspaceRoutes() {
  const app = new Hono();

  app.get("/api/users/me/workspaces/", async (c) => {
    const env = c.get("env") as Env;
    const { cache } = getCache(c);
    if (cache.ready && cache.workspace) {
      const ws = cache.workspace;
      return c.json([
        {
          id: ws.id,
          name: ws.name,
          slug: ws.slug,
          logo_url: ws.logo_url,
          role: 20,
          total_members: ws.total_members,
          total_projects: cache.projects.length,
        },
      ]);
    }
    const bootstrap = createBootstrapContext(env);
    return c.json([bootstrap.workspaceListItem]);
  });

  return app;
}
