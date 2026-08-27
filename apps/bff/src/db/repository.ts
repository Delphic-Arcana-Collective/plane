import type { TIssue } from "@plane/types";
import type { LinearSyncSnapshot } from "../linear/client.js";
import type { Env } from "../env.js";
import {
  DATA_SOURCE_LINEAR,
  DATA_SOURCE_PLANE,
  SYNC_META_ID,
  TAG_LINEAR,
  TAG_PLANE,
  isLinearTag,
} from "./constants.js";
import {
  type CommentRow,
  type IssueRow,
  type LabelRow,
  type PersistedRow,
  type ProjectRow,
  type StateRow,
  rowsToPlaneCache,
  snapshotToLinearRows,
  planeIssueToRow,
} from "./serialize.js";
import type { PlaneCache } from "../cache/backend.js";

const CHUNK_SIZE = 100;

const LINEAR_TABLES = ["projects", "states", "labels", "users", "issues", "comments"] as const;
type LinearTable = (typeof LINEAR_TABLES)[number];

function assertLinearTable(table: string): asserts table is LinearTable {
  if (!(LINEAR_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Invalid linear table: ${table}`);
  }
}

export class D1Repository {
  constructor(
    private readonly db: D1Database,
    private readonly workspaceId: string
  ) {}

  async tryAcquireLinearLock(_holder: string): Promise<boolean> {
    const result = await this.db
      .prepare(`UPDATE sync_meta SET linear_locked = 1, linear_locked_at = ? WHERE id = ? AND linear_locked = 0`)
      .bind(new Date().toISOString(), SYNC_META_ID)
      .run();
    if ((result.meta.changes ?? 0) > 0) return true;

    const row = await this.db
      .prepare(`SELECT linear_locked_at FROM sync_meta WHERE id = ?`)
      .bind(SYNC_META_ID)
      .first<{ linear_locked_at: string | null }>();
    if (!row?.linear_locked_at) return false;
    const lockedAt = Date.parse(row.linear_locked_at);
    if (Number.isFinite(lockedAt) && Date.now() - lockedAt > 5 * 60_000) {
      await this.db
        .prepare(`UPDATE sync_meta SET linear_locked = 0, linear_locked_at = NULL WHERE id = ?`)
        .bind(SYNC_META_ID)
        .run();
      return this.tryAcquireLinearLock(_holder);
    }
    return false;
  }

  async releaseLinearLock(): Promise<void> {
    await this.db
      .prepare(`UPDATE sync_meta SET linear_locked = 0, linear_locked_at = NULL WHERE id = ?`)
      .bind(SYNC_META_ID)
      .run();
  }

  async isLinearLockHeld(): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT linear_locked FROM sync_meta WHERE id = ?`)
      .bind(SYNC_META_ID)
      .first<{ linear_locked: number }>();
    return row?.linear_locked === 1;
  }

  async markWebhookDeliveryProcessed(deliveryId: string): Promise<boolean> {
    const result = await this.db
      .prepare(`INSERT OR IGNORE INTO webhook_deliveries (delivery_id, received_at) VALUES (?, ?)`)
      .bind(deliveryId, new Date().toISOString())
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  /**
   * Full Linear replace while the caller holds the sync lock:
   * upsert every Linear entity, then delete Linear orphans not in the snapshot.
   * Plane-tagged rows are never touched.
   */
  async replaceLinearSnapshot(snapshot: LinearSyncSnapshot, env: Env): Promise<void> {
    const rows = snapshotToLinearRows(snapshot, env, this.workspaceId);
    const statements: D1PreparedStatement[] = [];

    if (rows.workspace) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO workspaces (id, slug, name, payload, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name=excluded.name, payload=excluded.payload, updated_at=excluded.updated_at`
          )
          .bind(
            rows.workspace.id,
            rows.workspace.slug,
            rows.workspace.name,
            rows.workspace.payload,
            rows.workspace.updated_at
          )
      );
    }

    const linearProjectIds = rows.projects.map((p) => p.external_id);
    const linearIssueIds = rows.issues.map((i) => i.external_id);
    const linearCommentIds = rows.comments.map((c) => c.external_id);
    const linearStateIds = rows.states.map((s) => s.external_id);
    const linearLabelIds = rows.labels.map((l) => l.external_id);
    const linearUserIds = rows.users.map((u) => u.external_id);

    // Wipe Linear states/labels before insert so project-scoped ids can replace
    // legacy bare-state-id rows without PRIMARY KEY / UNIQUE collisions.
    statements.push(
      this.db
        .prepare(`DELETE FROM states WHERE workspace_id = ? AND source = ?`)
        .bind(this.workspaceId, DATA_SOURCE_LINEAR)
    );
    statements.push(
      this.db
        .prepare(`DELETE FROM labels WHERE workspace_id = ? AND source = ?`)
        .bind(this.workspaceId, DATA_SOURCE_LINEAR)
    );

    for (const chunk of chunkArray(rows.projects, CHUNK_SIZE)) {
      for (const row of chunk) statements.push(this.upsertProjectStmt(row));
    }
    for (const chunk of chunkArray(rows.states, CHUNK_SIZE)) {
      for (const row of chunk) statements.push(this.upsertStateStmt(row));
    }
    for (const chunk of chunkArray(rows.labels, CHUNK_SIZE)) {
      for (const row of chunk) statements.push(this.upsertLabelStmt(row));
    }
    for (const chunk of chunkArray(rows.users, CHUNK_SIZE)) {
      for (const row of chunk) statements.push(this.upsertUserStmt(row));
    }
    for (const chunk of chunkArray(rows.issues, CHUNK_SIZE)) {
      for (const row of chunk) statements.push(this.upsertIssueStmt(row));
    }
    for (const chunk of chunkArray(rows.comments, CHUNK_SIZE)) {
      for (const row of chunk) statements.push(this.upsertCommentStmt(row));
    }

    await this.runBatched(statements);

    await this.purgeLinearOrphans("projects", linearProjectIds);
    await this.purgeLinearOrphans("states", linearStateIds);
    await this.purgeLinearOrphans("labels", linearLabelIds);
    await this.purgeLinearOrphans("users", linearUserIds);
    await this.purgeLinearOrphans("issues", linearIssueIds);
    await this.purgeLinearOrphans("comments", linearCommentIds);

    await this.db
      .prepare(`UPDATE sync_meta SET last_linear_sync_at = ?, last_error = NULL WHERE id = ?`)
      .bind(new Date().toISOString(), SYNC_META_ID)
      .run();
  }

  async upsertPlaneIssue(issue: TIssue, projectName: string): Promise<void> {
    const existing = await this.db
      .prepare(`SELECT source, tag FROM issues WHERE workspace_id = ? AND external_id = ?`)
      .bind(this.workspaceId, issue.id)
      .all<{ source: string; tag: string }>();

    const rows = existing.results ?? [];
    const hasLinear = rows.some((row) => row.source === DATA_SOURCE_LINEAR || isLinearTag(row.tag));
    const hasPlane = rows.some((row) => row.source === DATA_SOURCE_PLANE);

    // Never mutate Linear-tagged rows. Same external_id may exist as Linear — only upsert Plane source.
    if (hasLinear && !hasPlane && rows.length > 0) {
      throw new Error("Cannot mutate Linear-tagged issue");
    }

    const row = planeIssueToRow(issue, this.workspaceId, projectName);
    await this.upsertIssueStmt(row).run();
  }

  async deletePlaneIssue(externalId: string): Promise<boolean> {
    const result = await this.db
      .prepare(`DELETE FROM issues WHERE workspace_id = ? AND source = ? AND tag = ? AND external_id = ?`)
      .bind(this.workspaceId, DATA_SOURCE_PLANE, TAG_PLANE, externalId)
      .run();
    if ((result.meta.changes ?? 0) > 0) return true;

    const linear = await this.db
      .prepare(
        `SELECT 1 AS ok FROM issues WHERE workspace_id = ? AND external_id = ? AND (source = ? OR tag = ?) LIMIT 1`
      )
      .bind(this.workspaceId, externalId, DATA_SOURCE_LINEAR, TAG_LINEAR)
      .first<{ ok: number }>();
    if (linear) return false;
    return false;
  }

  async loadPlaneCache(): Promise<PlaneCache> {
    const workspaceRow = await this.db
      .prepare(`SELECT payload FROM workspaces WHERE id = ?`)
      .bind(this.workspaceId)
      .first<{ payload: string }>();

    const projectRows = await this.all<ProjectRow>(`SELECT * FROM projects WHERE workspace_id = ?`, this.workspaceId);
    const stateRows = await this.all<StateRow>(`SELECT * FROM states WHERE workspace_id = ?`, this.workspaceId);
    const labelRows = await this.all<LabelRow>(`SELECT * FROM labels WHERE workspace_id = ?`, this.workspaceId);
    const userRows = await this.all<PersistedRow>(`SELECT * FROM users WHERE workspace_id = ?`, this.workspaceId);
    const issueRows = await this.all<IssueRow>(`SELECT * FROM issues WHERE workspace_id = ?`, this.workspaceId);
    const commentRows = await this.all<CommentRow>(`SELECT * FROM comments WHERE workspace_id = ?`, this.workspaceId);

    return rowsToPlaneCache(workspaceRow, projectRows, stateRows, labelRows, userRows, issueRows, commentRows);
  }

  async setSyncError(message: string): Promise<void> {
    await this.db.prepare(`UPDATE sync_meta SET last_error = ? WHERE id = ?`).bind(message, SYNC_META_ID).run();
  }

  private upsertProjectStmt(row: ProjectRow) {
    return this.db
      .prepare(
        `INSERT INTO projects (id, workspace_id, name, source, external_id, tag, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, source, external_id) DO UPDATE SET
           id=excluded.id, name=excluded.name, tag=excluded.tag, payload=excluded.payload, updated_at=excluded.updated_at`
      )
      .bind(row.id, row.workspace_id, row.name, row.source, row.external_id, row.tag, row.payload, row.updated_at);
  }

  private upsertStateStmt(row: StateRow) {
    return this.db
      .prepare(
        `INSERT INTO states (id, workspace_id, project_id, source, external_id, tag, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id=excluded.project_id, external_id=excluded.external_id, tag=excluded.tag,
           payload=excluded.payload, updated_at=excluded.updated_at`
      )
      .bind(
        row.id,
        row.workspace_id,
        row.project_id,
        row.source,
        row.external_id,
        row.tag,
        row.payload,
        row.updated_at
      );
  }

  private upsertLabelStmt(row: LabelRow) {
    return this.db
      .prepare(
        `INSERT INTO labels (id, workspace_id, project_id, source, external_id, tag, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id=excluded.project_id, external_id=excluded.external_id, tag=excluded.tag,
           payload=excluded.payload, updated_at=excluded.updated_at`
      )
      .bind(
        row.id,
        row.workspace_id,
        row.project_id,
        row.source,
        row.external_id,
        row.tag,
        row.payload,
        row.updated_at
      );
  }

  private upsertUserStmt(row: {
    id: string;
    workspace_id: string;
    source: string;
    external_id: string;
    tag: string;
    payload: string;
    updated_at: string;
  }) {
    return this.db
      .prepare(
        `INSERT INTO users (id, workspace_id, source, external_id, tag, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, source, external_id) DO UPDATE SET
           tag=excluded.tag, payload=excluded.payload, updated_at=excluded.updated_at`
      )
      .bind(row.id, row.workspace_id, row.source, row.external_id, row.tag, row.payload, row.updated_at);
  }

  private upsertIssueStmt(row: IssueRow) {
    return this.db
      .prepare(
        `INSERT INTO issues (id, workspace_id, project_id, project_name, source, external_id, tag, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, source, external_id) DO UPDATE SET
           project_id=excluded.project_id, project_name=excluded.project_name, tag=excluded.tag,
           payload=excluded.payload, updated_at=excluded.updated_at`
      )
      .bind(
        row.id,
        row.workspace_id,
        row.project_id,
        row.project_name,
        row.source,
        row.external_id,
        row.tag,
        row.payload,
        row.updated_at
      );
  }

  private upsertCommentStmt(row: CommentRow) {
    return this.db
      .prepare(
        `INSERT INTO comments (id, workspace_id, issue_id, source, external_id, tag, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, source, external_id) DO UPDATE SET
           issue_id=excluded.issue_id, tag=excluded.tag, payload=excluded.payload, updated_at=excluded.updated_at`
      )
      .bind(row.id, row.workspace_id, row.issue_id, row.source, row.external_id, row.tag, row.payload, row.updated_at);
  }

  /**
   * Delete Linear rows whose external_id is absent from the snapshot.
   * Computes orphans in JS and deletes by IN (...) chunks to avoid SQLite bind limits.
   */
  private async purgeLinearOrphans(table: LinearTable, keepExternalIds: string[]): Promise<void> {
    assertLinearTable(table);
    const keep = new Set(keepExternalIds);
    const existing = await this.all<{ external_id: string }>(
      `SELECT external_id FROM ${table} WHERE workspace_id = ? AND source = ?`,
      this.workspaceId,
      DATA_SOURCE_LINEAR
    );
    const orphans = existing.map((row) => row.external_id).filter((id) => !keep.has(id));
    if (orphans.length === 0) return;

    // D1 statement size / batch limits require sequential chunks.
    for (const chunk of chunkArray(orphans, CHUNK_SIZE)) {
      const placeholders = chunk.map(() => "?").join(", ");
      // eslint-disable-next-line no-await-in-loop -- intentional sequential chunk deletes
      await this.db
        .prepare(`DELETE FROM ${table} WHERE workspace_id = ? AND source = ? AND external_id IN (${placeholders})`)
        .bind(this.workspaceId, DATA_SOURCE_LINEAR, ...chunk)
        .run();
    }
  }

  private async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    const result = await this.db
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return result.results ?? [];
  }

  private async runBatched(statements: D1PreparedStatement[]): Promise<void> {
    for (let index = 0; index < statements.length; index += CHUNK_SIZE) {
      const slice = statements.slice(index, index + CHUNK_SIZE);
      // eslint-disable-next-line no-await-in-loop -- D1 batch size limits
      await this.db.batch(slice);
    }
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
