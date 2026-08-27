import { describe, expect, it } from "vitest";
import type { TIssue } from "@plane/types";
import { D1KvCacheBackend } from "../src/cache/d1-kv-backend.js";
import { KV_KEYS, serializePlaneCache } from "../src/cache/serialization.js";
import { BFF_WORKSPACE_ID } from "../src/bootstrap/session.js";
import {
  DATA_SOURCE_LINEAR,
  DATA_SOURCE_PLANE,
  TAG_LINEAR,
  TAG_PLANE,
  rowId,
  tagForSource,
} from "../src/db/constants.js";
import { D1Repository } from "../src/db/repository.js";
import { attachSourceMetadata, planeIssueToRow, rowsToPlaneCache } from "../src/db/serialize.js";
import { createTestEnv, createTestSnapshot } from "./test-utils.js";
import { MemoryD1Database } from "./memory-d1.js";

const WORKSPACE_ID = BFF_WORKSPACE_ID;
const PROJECT_NAME = "Shared Project";

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

function createRepo(db: MemoryD1Database = new MemoryD1Database()) {
  return { db, repo: new D1Repository(db, WORKSPACE_ID) };
}

function makePlaneIssue(id: string, projectId: string): TIssue {
  return {
    id,
    sequence_id: 99,
    name: `Plane issue ${id}`,
    sort_order: 1,
    state_id: "state-1",
    priority: "none",
    label_ids: [],
    assignee_ids: [],
    estimate_point: null,
    sub_issues_count: 0,
    attachment_count: 0,
    link_count: 0,
    project_id: projectId,
    parent_id: null,
    cycle_id: null,
    module_ids: null,
    type_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    start_date: null,
    target_date: null,
    completed_at: null,
    archived_at: null,
    created_by: "user-1",
    updated_by: "user-1",
    is_draft: false,
  };
}

describe("D1 data model constants", () => {
  it("tags linear and plane sources correctly", () => {
    expect(TAG_LINEAR).toBe("Linear");
    expect(TAG_PLANE).toBe("Plane");
    expect(DATA_SOURCE_LINEAR).toBe("linear");
    expect(DATA_SOURCE_PLANE).toBe("plane");
    expect(tagForSource(DATA_SOURCE_LINEAR)).toBe(TAG_LINEAR);
    expect(tagForSource(DATA_SOURCE_PLANE)).toBe(TAG_PLANE);
    expect(rowId(DATA_SOURCE_LINEAR, "abc")).toBe("linear:abc");
  });
});

describe("D1Repository", () => {
  it("allows only one concurrent linear lock holder", async () => {
    const { repo } = createRepo();
    const [first, second] = await Promise.all([
      repo.tryAcquireLinearLock("worker-a"),
      repo.tryAcquireLinearLock("worker-b"),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await repo.isLinearLockHeld()).toBe(true);

    await repo.releaseLinearLock();
    expect(await repo.isLinearLockHeld()).toBe(false);
    expect(await repo.tryAcquireLinearLock("worker-c")).toBe(true);
  });

  it("replaceLinearSnapshot upserts rows and deletes linear orphans", async () => {
    const { db, repo } = createRepo();
    const env = createTestEnv();

    await repo.replaceLinearSnapshot(createTestSnapshot(), env);
    let issues = db._rows("issues");
    expect(issues.filter((row) => row.source === DATA_SOURCE_LINEAR)).toHaveLength(2);

    const trimmed = createTestSnapshot();
    trimmed.issues = trimmed.issues.slice(0, 1);
    await repo.replaceLinearSnapshot(trimmed, env);

    issues = db._rows("issues").filter((row) => row.source === DATA_SOURCE_LINEAR);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.external_id).toBe("issue-1");
  });

  it("two Linear projects sharing a team both get non-empty states after D1 round-trip", async () => {
    const { db, repo } = createRepo();
    const env = createTestEnv();
    const snapshot = createTestSnapshot();
    snapshot.projects = [
      {
        id: "d23ecd8d-0d06-43b1-a2f3-350b9a809562",
        name: "音乐制作",
        description: "Project A",
        slugId: "music",
        teamIds: ["team-del"],
        primaryTeamId: "team-del",
        primaryTeamKey: "DEL",
      },
      {
        id: "project-b-shared-team",
        name: "Other Project",
        description: "Project B",
        slugId: "other",
        teamIds: ["team-del"],
        primaryTeamId: "team-del",
        primaryTeamKey: "DEL",
      },
    ];
    snapshot.issues = [
      {
        ...snapshot.issues[0]!,
        id: "issue-a",
        identifier: "DEL-10",
        projectId: "d23ecd8d-0d06-43b1-a2f3-350b9a809562",
      },
      {
        ...snapshot.issues[1]!,
        id: "issue-b",
        identifier: "DEL-11",
        projectId: "project-b-shared-team",
      },
    ];

    await repo.replaceLinearSnapshot(snapshot, env);

    const stateRows = db._rows("states").filter((row) => row.source === DATA_SOURCE_LINEAR);
    // Project-scoped external_ids — not collapsed by UNIQUE(workspace, source, external_id).
    expect(stateRows.length).toBe(4); // 2 states × 2 projects
    expect(new Set(stateRows.map((row) => row.external_id)).size).toBe(4);

    const cache = await repo.loadPlaneCache();
    const projectA = "d23ecd8d-0d06-43b1-a2f3-350b9a809562";
    const projectB = "project-b-shared-team";

    expect(cache.statesByProject.get(projectA)?.length).toBeGreaterThan(0);
    expect(cache.statesByProject.get(projectB)?.length).toBeGreaterThan(0);
    expect(
      cache.statesByProject
        .get(projectA)
        ?.map((s) => s.id)
        .toSorted()
    ).toEqual(
      cache.statesByProject
        .get(projectB)
        ?.map((s) => s.id)
        .toSorted()
    );
    expect(cache.labelsByProject.get(projectA)?.length).toBeGreaterThan(0);
    expect(cache.labelsByProject.get(projectB)?.length).toBeGreaterThan(0);
  });

  it("upserts plane issues with source metadata and refuses linear deletes", async () => {
    const { db, repo } = createRepo();
    const env = createTestEnv();

    await repo.replaceLinearSnapshot(createTestSnapshot(), env);

    const planeProjectId = "plane-project-1";
    const planeIssue = makePlaneIssue("plane-issue-1", planeProjectId);
    await repo.upsertPlaneIssue(planeIssue, PROJECT_NAME);

    const planeRow = db._rows("issues").find((row) => row.external_id === "plane-issue-1");
    expect(planeRow?.source).toBe(DATA_SOURCE_PLANE);
    expect(planeRow?.tag).toBe(TAG_PLANE);
    const payload = JSON.parse(String(planeRow?.payload));
    expect(payload.source).toBe(DATA_SOURCE_PLANE);
    expect(payload.system_tag).toBe(TAG_PLANE);
    expect(payload.tag).toBe(TAG_PLANE);

    expect(await repo.deletePlaneIssue("issue-1")).toBe(false);
    expect(db._rows("issues").some((row) => row.external_id === "issue-1")).toBe(true);

    expect(await repo.deletePlaneIssue("plane-issue-1")).toBe(true);
    expect(db._rows("issues").some((row) => row.external_id === "plane-issue-1")).toBe(false);
  });

  it("deletePlaneIssue refuses linear source even when looked up by external_id only", async () => {
    const { repo } = createRepo();
    await repo.replaceLinearSnapshot(createTestSnapshot(), createTestEnv());

    const deleted = await repo.deletePlaneIssue("issue-2");
    expect(deleted).toBe(false);
  });

  it("upsertPlaneIssue refuses to create a Plane row that would shadow a Linear-only issue", async () => {
    const { repo } = createRepo();
    await repo.replaceLinearSnapshot(createTestSnapshot(), createTestEnv());

    await expect(repo.upsertPlaneIssue(makePlaneIssue("issue-1", "plane-proj"), PROJECT_NAME)).rejects.toThrow(
      /Linear-tagged/
    );
  });

  it("linear orphan purge does not delete Plane-tagged issues", async () => {
    const { db, repo } = createRepo();
    const env = createTestEnv();
    await repo.replaceLinearSnapshot(createTestSnapshot(), env);
    await repo.upsertPlaneIssue(makePlaneIssue("plane-keep", "plane-proj"), PROJECT_NAME);

    const emptyIssues = createTestSnapshot();
    emptyIssues.issues = [];
    await repo.replaceLinearSnapshot(emptyIssues, env);

    const planeRows = db._rows("issues").filter((row) => row.source === DATA_SOURCE_PLANE);
    expect(planeRows).toHaveLength(1);
    expect(planeRows[0]?.external_id).toBe("plane-keep");
    expect(db._rows("issues").filter((row) => row.source === DATA_SOURCE_LINEAR)).toHaveLength(0);
  });
});

describe("rowsToPlaneCache name merge", () => {
  it("merges issues from linear and plane projects that share a name", () => {
    const linearProjectId = "project-del-1";
    const planeProjectId = "plane-project-1";
    const linearIssue = attachSourceMetadata(
      { id: "issue-linear", name: "Linear task", project_id: linearProjectId } as Record<string, unknown>,
      DATA_SOURCE_LINEAR
    );
    const planeIssue = attachSourceMetadata(
      { id: "issue-plane", name: "Plane task", project_id: planeProjectId } as Record<string, unknown>,
      DATA_SOURCE_PLANE
    );

    const cache = rowsToPlaneCache(
      null,
      [
        {
          id: rowId(DATA_SOURCE_LINEAR, linearProjectId),
          workspace_id: WORKSPACE_ID,
          name: PROJECT_NAME,
          source: DATA_SOURCE_LINEAR,
          external_id: linearProjectId,
          tag: TAG_LINEAR,
          payload: JSON.stringify({ id: linearProjectId, name: PROJECT_NAME }),
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: rowId(DATA_SOURCE_PLANE, planeProjectId),
          workspace_id: WORKSPACE_ID,
          name: PROJECT_NAME,
          source: DATA_SOURCE_PLANE,
          external_id: planeProjectId,
          tag: TAG_PLANE,
          payload: JSON.stringify({ id: planeProjectId, name: PROJECT_NAME }),
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      [],
      [],
      [],
      [
        {
          id: rowId(DATA_SOURCE_LINEAR, "issue-linear"),
          workspace_id: WORKSPACE_ID,
          project_id: rowId(DATA_SOURCE_LINEAR, linearProjectId),
          project_name: PROJECT_NAME,
          source: DATA_SOURCE_LINEAR,
          external_id: "issue-linear",
          tag: TAG_LINEAR,
          payload: JSON.stringify(linearIssue),
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: rowId(DATA_SOURCE_PLANE, "issue-plane"),
          workspace_id: WORKSPACE_ID,
          project_id: rowId(DATA_SOURCE_PLANE, planeProjectId),
          project_name: PROJECT_NAME,
          source: DATA_SOURCE_PLANE,
          external_id: "issue-plane",
          tag: TAG_PLANE,
          payload: JSON.stringify(planeIssue),
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      []
    );

    const canonicalProject = cache.projects.find((project) => project.name === PROJECT_NAME);
    expect(canonicalProject).toBeDefined();
    expect(canonicalProject!.id).toBe(linearProjectId);

    const merged = cache.issuesByProject.get(canonicalProject!.id) ?? [];
    expect(merged.map((issue) => issue.id).toSorted()).toEqual(["issue-linear", "issue-plane"]);

    // Non-canonical (Plane) project id still resolves the same merged issue set.
    const viaPlaneId = cache.issuesByProject.get(planeProjectId) ?? [];
    expect(viaPlaneId.map((issue) => issue.id).toSorted()).toEqual(["issue-linear", "issue-plane"]);
  });

  it("indexes states/labels under every namesake project id after name merge", () => {
    const linearProjectId = "project-del-1";
    const planeProjectId = "plane-project-1";
    const statePayload = {
      id: "state-todo",
      name: "Todo",
      project_id: linearProjectId,
      color: "#ccc",
      group: "unstarted",
    };
    const labelPayload = {
      id: "label-1",
      name: "Bug",
      project_id: linearProjectId,
      color: "#f00",
    };

    const cache = rowsToPlaneCache(
      null,
      [
        {
          id: rowId(DATA_SOURCE_LINEAR, linearProjectId),
          workspace_id: WORKSPACE_ID,
          name: PROJECT_NAME,
          source: DATA_SOURCE_LINEAR,
          external_id: linearProjectId,
          tag: TAG_LINEAR,
          payload: JSON.stringify({ id: linearProjectId, name: PROJECT_NAME, source: DATA_SOURCE_LINEAR }),
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: rowId(DATA_SOURCE_PLANE, planeProjectId),
          workspace_id: WORKSPACE_ID,
          name: PROJECT_NAME,
          source: DATA_SOURCE_PLANE,
          external_id: planeProjectId,
          tag: TAG_PLANE,
          payload: JSON.stringify({ id: planeProjectId, name: PROJECT_NAME, source: DATA_SOURCE_PLANE }),
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      [
        {
          id: rowId(DATA_SOURCE_LINEAR, `${linearProjectId}:state-todo`),
          workspace_id: WORKSPACE_ID,
          project_id: rowId(DATA_SOURCE_LINEAR, linearProjectId),
          source: DATA_SOURCE_LINEAR,
          external_id: `${linearProjectId}:state-todo`,
          tag: TAG_LINEAR,
          payload: JSON.stringify(statePayload),
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      [
        {
          id: rowId(DATA_SOURCE_LINEAR, `${linearProjectId}:label-1`),
          workspace_id: WORKSPACE_ID,
          project_id: rowId(DATA_SOURCE_LINEAR, linearProjectId),
          source: DATA_SOURCE_LINEAR,
          external_id: `${linearProjectId}:label-1`,
          tag: TAG_LINEAR,
          payload: JSON.stringify(labelPayload),
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      [],
      [],
      []
    );

    expect(cache.statesByProject.get(linearProjectId)?.map((s) => s.id)).toEqual(["state-todo"]);
    expect(cache.statesByProject.get(planeProjectId)?.map((s) => s.id)).toEqual(["state-todo"]);
    expect(cache.labelsByProject.get(linearProjectId)?.map((l) => l.id)).toEqual(["label-1"]);
    expect(cache.labelsByProject.get(planeProjectId)?.map((l) => l.id)).toEqual(["label-1"]);
  });

  it("planeIssueToRow embeds source metadata in payload", () => {
    const issue = makePlaneIssue("plane-1", "proj-1");
    const row = planeIssueToRow(issue, WORKSPACE_ID, PROJECT_NAME);
    const payload = JSON.parse(row.payload);
    expect(payload.source).toBe(DATA_SOURCE_PLANE);
    expect(payload.system_tag).toBe(TAG_PLANE);
    expect(payload.tag).toBe(TAG_PLANE);
  });
});

describe("D1KvCacheBackend", () => {
  it("getProjectIssues merges namesake projects from D1", async () => {
    const db = new MemoryD1Database();
    const kv = new MockKVNamespace();
    const repo = new D1Repository(db, WORKSPACE_ID);
    const env = createTestEnv();

    await repo.replaceLinearSnapshot(createTestSnapshot(), env);
    const linearProjectName = createTestSnapshot().projects[0]!.name;
    await repo.upsertPlaneIssue(makePlaneIssue("plane-only", "plane-proj"), linearProjectName);

    const backend = new D1KvCacheBackend(db, kv, WORKSPACE_ID);
    await backend.ensureLoaded();

    const linearProject = backend.cache.projects.find((project) => project.id === "project-del-1");
    expect(linearProject).toBeDefined();

    const issues = backend.getProjectIssues(linearProject!.id);
    const ids = issues.map((issue) => issue.id).toSorted();
    expect(ids).toContain("issue-1");
    expect(ids).toContain("issue-2");
    expect(ids).toContain("plane-only");
  });

  it("getIssue finds issues across namesake projects", async () => {
    const db = new MemoryD1Database();
    const kv = new MockKVNamespace();
    const repo = new D1Repository(db, WORKSPACE_ID);

    await repo.replaceLinearSnapshot(createTestSnapshot(), createTestEnv());
    await repo.upsertPlaneIssue(makePlaneIssue("plane-only", "plane-proj"), "不知道怎么分类项目");

    const backend = new D1KvCacheBackend(db, kv, WORKSPACE_ID);
    await backend.ensureLoaded();

    const linearProject = backend.cache.projects.find((project) => project.id === "project-del-1");
    expect(backend.getIssue(linearProject!.id, "plane-only")?.id).toBe("plane-only");
    expect(backend.getIssue(linearProject!.id, "issue-1")?.id).toBe("issue-1");
  });

  it("prefers D1 when last_linear_sync_at is newer than KV snapshot", async () => {
    const db = new MemoryD1Database();
    const kv = new MockKVNamespace();
    const repo = new D1Repository(db, WORKSPACE_ID);
    const env = createTestEnv();

    const staleCache = {
      ready: true,
      lastFetchedAt: "2026-01-01T00:00:00.000Z",
      error: null,
      stats: {
        teams: 0,
        projects: 0,
        issues: 0,
        states: 0,
        labels: 0,
        users: 0,
        comments: 0,
      },
      workspace: null,
      projects: [],
      statesByProject: new Map(),
      labelsByProject: new Map(),
      issuesByProject: new Map(),
      commentsByIssue: new Map(),
      users: new Map(),
      stateGroupById: new Map(),
    };
    await kv.put(KV_KEYS.snapshot, serializePlaneCache(staleCache));

    await repo.replaceLinearSnapshot(createTestSnapshot(), env);
    const metaRows = db._rows("sync_meta");
    metaRows[0]!.last_linear_sync_at = "2026-02-01T00:00:00.000Z";

    const backend = new D1KvCacheBackend(db, kv, WORKSPACE_ID);
    await backend.ensureLoaded();

    expect(backend.cache.projects.length).toBeGreaterThan(0);
    expect(backend.cache.issuesByProject.size).toBeGreaterThan(0);
  });

  it("reset clears KV and reloads from D1", async () => {
    const db = new MemoryD1Database();
    const kv = new MockKVNamespace();
    const repo = new D1Repository(db, WORKSPACE_ID);

    await repo.replaceLinearSnapshot(createTestSnapshot(), createTestEnv());
    const backend = new D1KvCacheBackend(db, kv, WORKSPACE_ID);
    await backend.ensureLoaded();
    expect(await kv.get(KV_KEYS.snapshot)).not.toBeNull();

    await backend.reset();
    expect(await kv.get(KV_KEYS.snapshot)).toBeNull();
    expect(backend.cache.projects.length).toBeGreaterThan(0);
  });

  it("plane write invalidates KV snapshot cache", async () => {
    const db = new MemoryD1Database();
    const kv = new MockKVNamespace();
    const repo = new D1Repository(db, WORKSPACE_ID);

    await repo.replaceLinearSnapshot(createTestSnapshot(), createTestEnv());
    const backend = new D1KvCacheBackend(db, kv, WORKSPACE_ID);
    await backend.ensureLoaded();
    expect(await kv.get(KV_KEYS.snapshot)).not.toBeNull();

    await backend.upsertPlaneIssue(makePlaneIssue("plane-write", "plane-proj"), "不知道怎么分类项目");
    expect(await kv.get(KV_KEYS.snapshot)).toBeNull();
  });
});
