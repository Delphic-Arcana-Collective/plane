import type { Env } from "../src/env.js";
import { cacheStore } from "../src/cache/store.js";
import { mapIssue, mapLabel, mapLinearProject, mapState, mapWorkspace } from "../src/mapper/index.js";
import { BFF_VIEWER_USER_ID } from "../src/bootstrap/session.js";
import type { LinearSyncSnapshot } from "../src/linear/client.js";
import { createServer } from "../src/server.js";

export const TEST_WORKSPACE_SLUG = "delphic";

export function createTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    BFF_PORT: 8000,
    NODE_ENV: "test",
    CORS_ORIGIN: "http://localhost:3000",
    PLANE_WORKSPACE_SLUG: TEST_WORKSPACE_SLUG,
    PLANE_WORKSPACE_NAME: "Delphic Arcana Collective",
    MOCK_USER_EMAIL: "dev@linear.local",
    MOCK_USER_NAME: "Linear Viewer",
    LINEAR_API_KEY: undefined,
    LINEAR_WORKSPACE_ID: undefined,
    CACHE_POLL_INTERVAL_MS: 60_000,
    CACHE_INITIAL_FETCH: false,
    ...overrides,
  };
}

export function createTestSnapshot(): LinearSyncSnapshot {
  return {
    organization: {
      id: "org-1",
      name: "Delphic Arcana Collective",
      urlKey: "delphic-arcana-collective",
    },
    users: [
      {
        id: BFF_VIEWER_USER_ID,
        name: "Linear Viewer",
        displayName: "Linear Viewer",
        email: "dev@linear.local",
        avatarUrl: "",
      },
    ],
    teams: [
      {
        id: "team-del",
        key: "DEL",
        name: "DEL",
        description: "Delphic team",
      },
    ],
    projects: [
      {
        id: "project-del-1",
        name: "不知道怎么分类项目",
        description: "Test project",
        slugId: "testslug",
        teamIds: ["team-del"],
        primaryTeamId: "team-del",
        primaryTeamKey: "DEL",
      },
    ],
    states: [
      {
        id: "state-todo",
        name: "Todo",
        color: "#cccccc",
        type: "unstarted",
        position: 0,
        teamId: "team-del",
      },
      {
        id: "state-done",
        name: "Done",
        color: "#00aa00",
        type: "completed",
        position: 1,
        teamId: "team-del",
      },
    ],
    labels: [
      {
        id: "label-1",
        name: "Bug",
        color: "#ff0000",
        teamId: "team-del",
      },
    ],
    issues: [
      {
        id: "issue-1",
        identifier: "DEL-1",
        title: "First issue",
        description: "Test issue one",
        priority: 2,
        sortOrder: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        dueDate: null,
        estimate: null,
        teamId: "team-del",
        projectId: "project-del-1",
        stateId: "state-todo",
        assigneeId: BFF_VIEWER_USER_ID,
        labelIds: ["label-1"],
        parentId: null,
        subIssuesCount: 0,
        createdById: BFF_VIEWER_USER_ID,
      },
      {
        id: "issue-2",
        identifier: "DEL-2",
        title: "Second issue",
        description: "Test issue two",
        priority: 3,
        sortOrder: 2,
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-04T00:00:00.000Z",
        dueDate: null,
        estimate: null,
        teamId: "team-del",
        projectId: "project-del-1",
        stateId: "state-done",
        assigneeId: BFF_VIEWER_USER_ID,
        labelIds: [],
        parentId: null,
        subIssuesCount: 0,
        createdById: BFF_VIEWER_USER_ID,
      },
    ],
    comments: [],
  };
}

export function seedTestCache(env: Env = createTestEnv()) {
  cacheStore.reset();
  cacheStore.applySnapshot(createTestSnapshot(), env);
  return cacheStore.cache;
}

export function createTestApp(env: Env = createTestEnv()) {
  seedTestCache(env);
  return createServer(env);
}

export async function getJson<T>(
  app: ReturnType<typeof createTestApp>,
  path: string
): Promise<{ status: number; body: T }> {
  const response = await app.request(path);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

export function getMockUserId() {
  return BFF_VIEWER_USER_ID;
}

export function getTestProjectId() {
  return "project-del-1";
}

export function getTestIssueId() {
  return "issue-1";
}

// Re-export mapper helpers used by unit tests
export { mapIssue, mapLabel, mapLinearProject, mapState, mapWorkspace };
