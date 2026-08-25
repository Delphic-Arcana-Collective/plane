import { Hono } from "hono";
import { cacheStore } from "../cache/store.js";
import { createBootstrapContext } from "../bootstrap/session.js";
import {
  createDataUserWorkspaceRoutes,
  createDataWorkspaceRoutes,
  createIssueRoutes,
  createLabelRoutes,
  createProjectRoutes,
  createStateRoutes,
} from "./data.js";
import { createStubRoutes } from "./stubs.js";

export function createInstanceRoutes() {
  const app = new Hono();

  app.get("/api/instances/", (c) => {
    const bootstrap = createBootstrapContext(c.get("env"));
    return c.json(bootstrap.instanceInfo);
  });

  app.get("/api/instances/configurations/", (c) => c.json([]));

  return app;
}

export function createAuthRoutes() {
  const app = new Hono();

  app.get("/auth/get-csrf-token/", (c) => c.json({ csrf_token: "linear-bff-mock-csrf-token" }));
  app.post("/auth/sign-out/", (c) => c.json({ message: "Signed out" }));

  return app;
}

export function createUserRoutes() {
  const app = new Hono();

  app.get("/api/users/me/", (c) => {
    const bootstrap = createBootstrapContext(c.get("env"));
    return c.json(bootstrap.viewer);
  });

  app.get("/api/users/me/profile/", (c) => {
    const bootstrap = createBootstrapContext(c.get("env"));
    return c.json(bootstrap.profile);
  });

  app.get("/api/users/me/settings/", (c) => {
    const bootstrap = createBootstrapContext(c.get("env"));
    const settings = { ...bootstrap.settings };
    if (cacheStore.cache.ready && cacheStore.cache.workspace) {
      settings.workspace = {
        ...settings.workspace,
        last_workspace_id: cacheStore.cache.workspace.id,
        last_workspace_slug: cacheStore.cache.workspace.slug,
        last_workspace_name: cacheStore.cache.workspace.name,
        fallback_workspace_id: cacheStore.cache.workspace.id,
        fallback_workspace_slug: cacheStore.cache.workspace.slug,
      };
    }
    return c.json(settings);
  });

  app.get("/api/users/me/workspaces/:slug/project-roles/", (c) => {
    const roles: Record<string, number> = {};
    for (const project of cacheStore.cache.projects) {
      roles[project.id] = 20;
    }
    return c.json(roles);
  });

  app.get("/api/users/me/workspaces/invitations/", (c) => c.json([]));

  return app;
}

export function createWorkspaceRoutes() {
  const app = new Hono();

  app.get("/api/workspaces/:slug/workspace-members/me/", (c) => {
    const bootstrap = createBootstrapContext(c.get("env"));
    return c.json(bootstrap.workspaceMemberMe);
  });

  app.get("/api/workspaces/:slug/members/", (c) => {
    const bootstrap = createBootstrapContext(c.get("env"));
    if (cacheStore.cache.users.size > 0) {
      return c.json(
        [...cacheStore.cache.users.values()].map((user) => ({
          id: `member-${user.id}`,
          member: user,
          role: 20,
          created_at: "2026-01-01T00:00:00.000Z",
          is_active: true,
          display_name: user.display_name,
          email: user.email,
        }))
      );
    }
    return c.json([bootstrap.fallbackMember]);
  });

  app.get("/api/workspaces/:slug/user-favorites/", (c) => c.json([]));
  app.get("/api/workspaces/:slug/sidebar-preferences/", (c) => c.json({}));
  app.get("/api/workspaces/:slug/user-properties/", (c) => {
    const bootstrap = createBootstrapContext(c.get("env"));
    return c.json(bootstrap.emptyWorkspaceUserProperties);
  });

  return app;
}

export function createRoutes() {
  const app = new Hono();

  app.route("/", createInstanceRoutes());
  app.route("/", createAuthRoutes());
  app.route("/", createUserRoutes());
  app.route("/", createDataUserWorkspaceRoutes());
  app.route("/", createWorkspaceRoutes());
  app.route("/", createDataWorkspaceRoutes());
  app.route("/", createProjectRoutes());
  app.route("/", createStateRoutes());
  app.route("/", createLabelRoutes());
  app.route("/", createIssueRoutes());
  app.route("/", createStubRoutes());

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "bff",
      cache: {
        ready: cacheStore.cache.ready,
        lastFetchedAt: cacheStore.cache.lastFetchedAt,
        error: cacheStore.cache.error,
        stats: cacheStore.cache.stats,
      },
    })
  );

  return app;
}
