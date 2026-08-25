import { afterEach, describe, expect, it } from "vitest";
import { cacheStore } from "../src/cache/store.js";
import {
  TEST_WORKSPACE_SLUG,
  createTestApp,
  createTestEnv,
  getJson,
  getMockUserId,
  getTestIssueId,
  getTestProjectId,
  seedTestCache,
} from "./test-utils.js";

type RouteCase = {
  name: string;
  method?: "GET";
  path: string;
  expectStatus?: number;
  assert?: (body: unknown) => void;
};

const slug = TEST_WORKSPACE_SLUG;
const projectId = getTestProjectId();
const issueId = getTestIssueId();
const userId = getMockUserId();

const ROUTES: RouteCase[] = [
  { name: "health", path: "/health", assert: (body) => expect(body).toMatchObject({ status: "ok" }) },
  { name: "instance", path: "/api/instances/", assert: (body) => expect(body).toHaveProperty("instance") },
  { name: "instance-config", path: "/api/instances/configurations/", assert: (body) => expect(body).toEqual([]) },
  { name: "csrf", path: "/auth/get-csrf-token/", assert: (body) => expect(body).toHaveProperty("csrf_token") },
  { name: "current-user", path: "/api/users/me/", assert: (body) => expect(body).toHaveProperty("id") },
  {
    name: "user-profile",
    path: "/api/users/me/profile/",
    assert: (body) => expect(body).toHaveProperty("is_onboarded", true),
  },
  {
    name: "user-settings",
    path: "/api/users/me/settings/",
    assert: (body) => expect(body).toHaveProperty("workspace"),
  },
  {
    name: "user-workspaces",
    path: "/api/users/me/workspaces/",
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "user-invitations",
    path: "/api/users/me/workspaces/invitations/",
    assert: (body) => expect(body).toEqual([]),
  },
  {
    name: "user-project-roles",
    path: `/api/users/me/workspaces/${slug}/project-roles/`,
    assert: (body) => expect(body).toHaveProperty(projectId),
  },
  { name: "workspace", path: `/api/workspaces/${slug}/`, assert: (body) => expect(body).toHaveProperty("slug", slug) },
  {
    name: "workspace-member-me",
    path: `/api/workspaces/${slug}/workspace-members/me/`,
    assert: (body) => expect(body).toHaveProperty("role"),
  },
  {
    name: "workspace-members",
    path: `/api/workspaces/${slug}/members/`,
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "workspace-favorites",
    path: `/api/workspaces/${slug}/user-favorites/`,
    assert: (body) => expect(body).toEqual([]),
  },
  {
    name: "workspace-sidebar-preferences",
    path: `/api/workspaces/${slug}/sidebar-preferences/`,
    assert: (body) => expect(body).toEqual({}),
  },
  {
    name: "workspace-user-properties",
    path: `/api/workspaces/${slug}/user-properties/`,
    assert: (body) => expect(body).toHaveProperty("navigation_project_limit"),
  },
  {
    name: "workspace-states",
    path: `/api/workspaces/${slug}/states/`,
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "workspace-labels",
    path: `/api/workspaces/${slug}/labels/`,
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "workspace-issues",
    path: `/api/workspaces/${slug}/issues/?per_page=10`,
    assert: (body) => expect(body).toHaveProperty("total_count", 2),
  },
  {
    name: "workspace-issues-detail",
    path: `/api/workspaces/${slug}/issues-detail/?per_page=10`,
    assert: (body) => expect(body).toHaveProperty("results"),
  },
  {
    name: "user-issues",
    path: `/api/workspaces/${slug}/user-issues/${userId}/?per_page=10&assignees=${userId}`,
    assert: (body) => expect(body).toHaveProperty("total_count", 2),
  },
  {
    name: "user-issues-cursor",
    path: `/api/workspaces/${slug}/user-issues/${userId}/?cursor=100:0:0&per_page=100&assignees=${userId}`,
    assert: (body) => expect(body).toHaveProperty("next_page_results", false),
  },
  {
    name: "user-stats",
    path: `/api/workspaces/${slug}/user-stats/${userId}/`,
    assert: (body) => expect(body).toHaveProperty("assigned_issues"),
  },
  {
    name: "user-profile-projects",
    path: `/api/workspaces/${slug}/user-profile/${userId}/`,
    assert: (body) => expect(body).toHaveProperty("project_data"),
  },
  {
    name: "home-preferences",
    path: `/api/workspaces/${slug}/home-preferences/`,
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "notifications-unread",
    path: `/api/workspaces/${slug}/users/notifications/unread/`,
    assert: (body) => expect(body).toHaveProperty("total_unread_notifications_count", 0),
  },
  {
    name: "notifications-list",
    path: `/api/workspaces/${slug}/users/notifications/?per_page=10`,
    assert: (body) => expect(body).toHaveProperty("results"),
  },
  { name: "quick-links", path: `/api/workspaces/${slug}/quick-links/`, assert: (body) => expect(body).toEqual([]) },
  { name: "recent-visits", path: `/api/workspaces/${slug}/recent-visits/`, assert: (body) => expect(body).toEqual([]) },
  {
    name: "projects",
    path: `/api/workspaces/${slug}/projects/`,
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "projects-details",
    path: `/api/workspaces/${slug}/projects/details/`,
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "project-detail",
    path: `/api/workspaces/${slug}/projects/${projectId}/`,
    assert: (body) => expect(body).toMatchObject({ identifier: "DEL", name: "不知道怎么分类项目" }),
  },
  {
    name: "project-states",
    path: `/api/workspaces/${slug}/projects/${projectId}/states/`,
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "project-labels",
    path: `/api/workspaces/${slug}/projects/${projectId}/issue-labels/`,
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "project-issues",
    path: `/api/workspaces/${slug}/projects/${projectId}/issues/?order_by=-created_at&per_page=100`,
    assert: (body) => expect(body).toHaveProperty("total_count", 2),
  },
  {
    name: "project-issues-kanban",
    path: `/api/workspaces/${slug}/projects/${projectId}/issues/?group_by=state&order_by=-created_at`,
    assert: (body) => expect(body).toHaveProperty("grouped_by", "state_id"),
  },
  {
    name: "project-issues-detail",
    path: `/api/workspaces/${slug}/projects/${projectId}/issues-detail/?per_page=10`,
    assert: (body) => expect(body).toHaveProperty("results"),
  },
  {
    name: "project-issue-detail",
    path: `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/`,
    assert: (body) => expect(body).toHaveProperty("name", "First issue"),
  },
  {
    name: "project-user-properties",
    path: `/api/workspaces/${slug}/projects/${projectId}/user-properties/`,
    assert: (body) => {
      expect(body).toHaveProperty("preferences");
      expect(body.display_filters?.group_by).toBe("state");
      expect(body.display_filters?.layout).toBe("list");
    },
  },
  {
    name: "project-members",
    path: `/api/workspaces/${slug}/projects/${projectId}/members/`,
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "project-member-me",
    path: `/api/workspaces/${slug}/projects/${projectId}/project-members/me/`,
    assert: (body) => expect(body).toHaveProperty("role"),
  },
  { name: "workspace-modules", path: `/api/workspaces/${slug}/modules/`, assert: (body) => expect(body).toEqual([]) },
  { name: "workspace-cycles", path: `/api/workspaces/${slug}/cycles/`, assert: (body) => expect(body).toEqual([]) },
  {
    name: "project-cycles",
    path: `/api/workspaces/${slug}/projects/${projectId}/cycles/`,
    assert: (body) => expect(body).toEqual([]),
  },
  {
    name: "project-modules",
    path: `/api/workspaces/${slug}/projects/${projectId}/modules/`,
    assert: (body) => expect(body).toEqual([]),
  },
  {
    name: "project-views",
    path: `/api/workspaces/${slug}/projects/${projectId}/views/`,
    assert: (body) => expect(body).toEqual([]),
  },
  {
    name: "project-estimates",
    path: `/api/workspaces/${slug}/projects/${projectId}/estimates/`,
    assert: (body) => expect(body).toEqual([]),
  },
  {
    name: "project-intake-state",
    path: `/api/workspaces/${slug}/projects/${projectId}/intake-state/`,
    assert: (body) => expect(body).toBeNull(),
  },
  {
    name: "issue-history",
    path: `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/history/?activity_type=issue-comment`,
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "issue-comments",
    path: `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/comments/`,
    assert: (body) => expect(Array.isArray(body)).toBe(true),
  },
  {
    name: "issue-links",
    path: `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/issue-links/`,
    assert: (body) => expect(body).toEqual([]),
  },
  {
    name: "issue-sub-issues",
    path: `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/sub-issues/`,
    assert: (body) => expect(body).toEqual([]),
  },
  {
    name: "issue-reactions",
    path: `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/reactions/`,
    assert: (body) => expect(body).toEqual([]),
  },
  {
    name: "issue-subscribe",
    path: `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/subscribe/`,
    assert: (body) => expect(body).toHaveProperty("subscribed", false),
  },
  {
    name: "issue-meta",
    path: `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/meta/`,
    assert: (body) => expect(body).toHaveProperty("attachment_count"),
  },
  {
    name: "work-item-identifier",
    path: `/api/workspaces/${slug}/work-items/DEL-1/`,
    assert: (body) => expect(body).toHaveProperty("sequence_id", 1),
  },
  {
    name: "issue-attachments",
    path: `/api/assets/v2/workspaces/${slug}/projects/${projectId}/issues/${issueId}/attachments/`,
    assert: (body) => expect(body).toEqual([]),
  },
];

describe("bff linear display API routes", () => {
  afterEach(() => {
    cacheStore.reset();
  });

  it.each(ROUTES)("$name → $path", async ({ path, expectStatus = 200, assert }) => {
    const app = createTestApp();
    const { status, body } = await getJson<unknown>(app, path);
    expect(status).toBe(expectStatus);
    assert?.(body);
  });

  it("persists project layout via user-properties patch", async () => {
    const app = createTestApp();
    const path = `/api/workspaces/${slug}/projects/${projectId}/user-properties/`;

    const patched = await app.request(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_filters: { layout: "kanban", group_by: "state" } }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { display_filters: { layout?: string } };
    expect(patchedBody.display_filters.layout).toBe("kanban");

    const { body } = await getJson<{ display_filters: { layout?: string } }>(app, path);
    expect(body.display_filters.layout).toBe("kanban");
  });

  it("returns 404 for unknown workspace slug", async () => {
    const app = createTestApp();
    const { status } = await getJson(app, "/api/workspaces/unknown/projects/");
    expect(status).toBe(404);
  });

  it("returns empty issues for unknown project", async () => {
    const app = createTestApp();
    const { status, body } = await getJson<{ total_count: number }>(
      app,
      `/api/workspaces/${slug}/projects/unknown-project/issues/`
    );
    expect(status).toBe(200);
    expect(body.total_count).toBe(0);
  });

  it("filters user issues by assignee", async () => {
    const app = createTestApp();
    const { body } = await getJson<{ total_count: number }>(
      app,
      `/api/workspaces/${slug}/user-issues/${userId}/?assignees=${userId}&per_page=10`
    );
    expect(body.total_count).toBe(2);
  });

  it("works without LINEAR_API_KEY when cache is seeded", async () => {
    const env = createTestEnv({ LINEAR_API_KEY: undefined });
    seedTestCache(env);
    const app = createTestApp(env);
    const { status, body } = await getJson<unknown>(app, `/api/workspaces/${slug}/projects/${projectId}/issues/`);
    expect(status).toBe(200);
    expect(body).toHaveProperty("total_count", 2);
  });
});
