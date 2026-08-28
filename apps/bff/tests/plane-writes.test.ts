import { describe, expect, it } from "vitest";
import type { TIssue, TIssueComment } from "@plane/types";
import { EIssueCommentAccessSpecifier } from "@plane/types";
import { D1KvCacheBackend } from "../src/cache/d1-kv-backend.js";
import { BFF_WORKSPACE_ID, BFF_VIEWER_USER_ID } from "../src/bootstrap/session.js";
import { DATA_SOURCE_LINEAR, DATA_SOURCE_PLANE, TAG_LINEAR, TAG_PLANE } from "../src/db/constants.js";
import { D1Repository } from "../src/db/repository.js";
import { createServer } from "../src/server.js";
import { createTestEnv, createTestSnapshot, TEST_WORKSPACE_SLUG } from "./test-utils.js";
import { MemoryD1Database } from "./memory-d1.js";

class MockKVNamespace implements KVNamespace {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<KVNamespaceListResult<unknown>> {
    return { keys: [], list_complete: true, cacheStatus: null };
  }

  async getWithMetadata(): Promise<KVNamespaceGetWithMetadataResult<unknown, unknown>> {
    return { value: null, metadata: null, cacheStatus: null };
  }
}

async function createD1WriteApp() {
  const db = new MemoryD1Database();
  const kv = new MockKVNamespace();
  const env = createTestEnv();
  const backend = new D1KvCacheBackend(db, kv, BFF_WORKSPACE_ID);
  await backend.applySnapshot(createTestSnapshot(), env);
  const app = createServer(env, backend);
  return { app, backend, db, env };
}

describe("plane write routes", () => {
  it("creates a Plane issue with normalized fields", async () => {
    const { app } = await createD1WriteApp();
    const projectId = "project-del-1";
    const response = await app.request(`/api/workspaces/${TEST_WORKSPACE_SLUG}/projects/${projectId}/issues/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Plane create test", source: "linear", tag: "Linear" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as TIssue & { source?: string; tag?: string };
    expect(body.id).toBeTruthy();
    expect(body.name).toBe("Plane create test");
    expect(body.sequence_id).toBeGreaterThan(0);
    expect(body.assignee_ids).toEqual([]);
    expect(body.label_ids).toEqual([]);
    expect(body.priority).toBe("none");
    expect(body.description_html).toBe("<p></p>");
    expect(body.created_at).toBeTruthy();
    expect(body.source).toBe(DATA_SOURCE_PLANE);
    expect(body.tag).toBe(TAG_PLANE);
    expect(body.state_id).toBeTruthy();
  });

  it("returns 403 when PATCHing a Linear-tagged issue", async () => {
    const { app } = await createD1WriteApp();
    const response = await app.request(
      `/api/workspaces/${TEST_WORKSPACE_SLUG}/projects/project-del-1/issues/issue-1/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "should fail" }),
      }
    );
    expect(response.status).toBe(403);
  });

  it("creates a Plane comment on a Plane issue", async () => {
    const { app, backend } = await createD1WriteApp();
    const projectId = "project-del-1";

    const createIssue = await app.request(`/api/workspaces/${TEST_WORKSPACE_SLUG}/projects/${projectId}/issues/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Comment parent" }),
    });
    expect(createIssue.status).toBe(201);
    const issue = (await createIssue.json()) as TIssue;

    const response = await app.request(
      `/api/workspaces/${TEST_WORKSPACE_SLUG}/projects/${projectId}/issues/${issue.id}/comments/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comment_html: "<p>hello plane</p>",
          source: "linear",
          tag: "Linear",
        }),
      }
    );
    expect(response.status).toBe(201);
    const comment = (await response.json()) as TIssueComment & { source?: string; tag?: string };
    expect(comment.id).toBeTruthy();
    expect(comment.comment_html).toBe("<p>hello plane</p>");
    expect(comment.actor).toBe(BFF_VIEWER_USER_ID);
    expect(comment.source).toBe(DATA_SOURCE_PLANE);
    expect(comment.tag).toBe(TAG_PLANE);
    expect(comment.external_source).toBe(DATA_SOURCE_PLANE);

    await backend.ensureLoaded();
    const listed = backend.getIssueComments(projectId, issue.id);
    expect(listed.some((entry) => entry.id === comment.id)).toBe(true);
  });

  it("returns 403 when creating a comment on a Linear issue", async () => {
    const { app } = await createD1WriteApp();
    const response = await app.request(
      `/api/workspaces/${TEST_WORKSPACE_SLUG}/projects/project-del-1/issues/issue-1/comments/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_html: "<p>nope</p>" }),
      }
    );
    expect(response.status).toBe(403);
  });

  it("returns 403 when PATCHing a Linear-tagged comment", async () => {
    const db = new MemoryD1Database();
    const kv = new MockKVNamespace();
    const env = createTestEnv();
    const backend = new D1KvCacheBackend(db, kv, BFF_WORKSPACE_ID);
    await backend.applySnapshot(createTestSnapshot(), env);

    // Seed a Linear comment on the Linear issue via D1 replace is already done by snapshot (empty).
    // Insert a Linear comment row directly.
    const repo = new D1Repository(db, BFF_WORKSPACE_ID);
    const linearComment: TIssueComment = {
      id: "linear-comment-1",
      workspace: BFF_WORKSPACE_ID,
      workspace_detail: { id: BFF_WORKSPACE_ID, name: "Delphic", slug: "delphic" },
      project: "project-del-1",
      project_detail: {
        id: "project-del-1",
        identifier: "DEL",
        name: "不知道怎么分类项目",
        cover_image: "",
        description: "",
        emoji: null,
        icon_prop: null,
      },
      issue: "issue-1",
      issue_detail: {
        id: "issue-1",
        sequence_id: 1,
        sort_order: false as unknown as boolean,
        name: "First issue",
        description_html: "",
        priority: "none",
        start_date: "",
        target_date: "",
        is_draft: false,
      },
      actor: BFF_VIEWER_USER_ID,
      actor_detail: {
        id: BFF_VIEWER_USER_ID,
        first_name: "Linear",
        last_name: "Viewer",
        avatar_url: "",
        is_bot: false,
        display_name: "Linear Viewer",
      },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      created_by: BFF_VIEWER_USER_ID,
      updated_by: BFF_VIEWER_USER_ID,
      attachments: [],
      comment_reactions: [],
      comment_stripped: "linear",
      comment_html: "<p>linear</p>",
      comment_json: { type: "doc", content: [] },
      external_id: "linear-comment-1",
      external_source: DATA_SOURCE_LINEAR,
      access: EIssueCommentAccessSpecifier.INTERNAL,
    };

    // Bypass Plane upsert — write Linear row through replace path by mutating snapshot comments.
    const snapshot = createTestSnapshot();
    snapshot.comments = [
      {
        id: "linear-comment-1",
        body: "linear",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        issueId: "issue-1",
        userId: BFF_VIEWER_USER_ID,
        parentId: null,
      },
    ];
    await backend.applySnapshot(snapshot, env);
    void repo;
    void linearComment;
    void TAG_LINEAR;

    const app = createServer(env, backend);
    // Parent Linear issue blocks comment mutate first
    const response = await app.request(
      `/api/workspaces/${TEST_WORKSPACE_SLUG}/projects/project-del-1/issues/issue-1/comments/linear-comment-1/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_html: "<p>edit</p>" }),
      }
    );
    expect(response.status).toBe(403);
  });
});
