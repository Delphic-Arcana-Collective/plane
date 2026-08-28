/**
 * Minimal in-memory D1 for unit tests. Supports the SQL shapes used by D1Repository.
 */
/* eslint-disable no-await-in-loop -- sequential statement.run mirrors D1 batch semantics */

type Row = Record<string, unknown>;

type TableName =
  | "sync_meta"
  | "webhook_deliveries"
  | "workspaces"
  | "projects"
  | "states"
  | "labels"
  | "users"
  | "issues"
  | "comments";

const TABLES: TableName[] = [
  "sync_meta",
  "webhook_deliveries",
  "workspaces",
  "projects",
  "states",
  "labels",
  "users",
  "issues",
  "comments",
];

function cloneRow(row: Row): Row {
  return { ...row };
}

export class MemoryD1Database implements D1Database {
  private readonly tables = new Map<TableName, Row[]>();

  constructor() {
    for (const name of TABLES) this.tables.set(name, []);
    this.tables.get("sync_meta")!.push({
      id: "default",
      linear_locked: 0,
      linear_locked_at: null,
      last_linear_sync_at: null,
      last_error: null,
    });
  }

  prepare(query: string): D1PreparedStatement {
    return new MemoryPreparedStatement(this, query);
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      results.push((await statement.run()) as D1Result<T>);
    }
    return results;
  }

  async exec(_query: string): Promise<D1ExecResult> {
    return { count: 0, duration: 0 };
  }

  /** @internal */
  _rows(table: TableName): Row[] {
    return this.tables.get(table)!;
  }

  /** @internal */
  _setRows(table: TableName, rows: Row[]): void {
    this.tables.set(table, rows);
  }
}

class MemoryPreparedStatement implements D1PreparedStatement {
  private binds: unknown[] = [];

  constructor(
    private readonly db: MemoryD1Database,
    private readonly query: string
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.binds = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const { results } = await this.all<T>();
    const row = results[0];
    if (!row) return null;
    if (colName) return (row as Record<string, unknown>)[colName] as T;
    return row;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const sql = normalize(this.query);
    let changes = 0;

    if (sql.startsWith("update sync_meta set linear_locked = 1")) {
      const rows = this.db._rows("sync_meta");
      const target = rows.find((row) => row.id === this.binds[1] && row.linear_locked === 0);
      if (target) {
        target.linear_locked = 1;
        target.linear_locked_at = this.binds[0];
        changes = 1;
      }
    } else if (sql.startsWith("update sync_meta set linear_locked = 0")) {
      const rows = this.db._rows("sync_meta");
      const target = rows.find((row) => row.id === this.binds[this.binds.length - 1]);
      if (target) {
        target.linear_locked = 0;
        target.linear_locked_at = null;
        changes = 1;
      }
    } else if (sql.startsWith("update sync_meta set last_linear_sync_at")) {
      const rows = this.db._rows("sync_meta");
      const target = rows.find((row) => row.id === this.binds[1]);
      if (target) {
        target.last_linear_sync_at = this.binds[0];
        target.last_error = null;
        changes = 1;
      }
    } else if (sql.startsWith("update sync_meta set last_error")) {
      const rows = this.db._rows("sync_meta");
      const target = rows.find((row) => row.id === this.binds[1]);
      if (target) {
        target.last_error = this.binds[0];
        changes = 1;
      }
    } else if (sql.startsWith("insert or ignore into webhook_deliveries")) {
      const rows = this.db._rows("webhook_deliveries");
      if (!rows.some((row) => row.delivery_id === this.binds[0])) {
        rows.push({ delivery_id: this.binds[0], received_at: this.binds[1] });
        changes = 1;
      }
    } else if (sql.startsWith("insert into workspaces")) {
      changes = this.upsertUnique("workspaces", ["id"], {
        id: this.binds[0],
        slug: this.binds[1],
        name: this.binds[2],
        payload: this.binds[3],
        updated_at: this.binds[4],
      });
    } else if (sql.startsWith("insert into projects")) {
      changes = this.upsertUnique("projects", ["workspace_id", "source", "external_id"], {
        id: this.binds[0],
        workspace_id: this.binds[1],
        name: this.binds[2],
        source: this.binds[3],
        external_id: this.binds[4],
        tag: this.binds[5],
        payload: this.binds[6],
        updated_at: this.binds[7],
      });
    } else if (sql.startsWith("insert into states")) {
      changes = this.upsertUnique("states", ["id"], {
        id: this.binds[0],
        workspace_id: this.binds[1],
        project_id: this.binds[2],
        source: this.binds[3],
        external_id: this.binds[4],
        tag: this.binds[5],
        payload: this.binds[6],
        updated_at: this.binds[7],
      });
    } else if (sql.startsWith("insert into labels")) {
      changes = this.upsertUnique("labels", ["id"], {
        id: this.binds[0],
        workspace_id: this.binds[1],
        project_id: this.binds[2],
        source: this.binds[3],
        external_id: this.binds[4],
        tag: this.binds[5],
        payload: this.binds[6],
        updated_at: this.binds[7],
      });
    } else if (sql.startsWith("insert into users")) {
      changes = this.upsertUnique("users", ["workspace_id", "source", "external_id"], {
        id: this.binds[0],
        workspace_id: this.binds[1],
        source: this.binds[2],
        external_id: this.binds[3],
        tag: this.binds[4],
        payload: this.binds[5],
        updated_at: this.binds[6],
      });
    } else if (sql.startsWith("insert into issues")) {
      changes = this.upsertUnique("issues", ["workspace_id", "source", "external_id"], {
        id: this.binds[0],
        workspace_id: this.binds[1],
        project_id: this.binds[2],
        project_name: this.binds[3],
        source: this.binds[4],
        external_id: this.binds[5],
        tag: this.binds[6],
        payload: this.binds[7],
        updated_at: this.binds[8],
      });
    } else if (sql.startsWith("insert into comments")) {
      changes = this.upsertUnique("comments", ["workspace_id", "source", "external_id"], {
        id: this.binds[0],
        workspace_id: this.binds[1],
        issue_id: this.binds[2],
        source: this.binds[3],
        external_id: this.binds[4],
        tag: this.binds[5],
        payload: this.binds[6],
        updated_at: this.binds[7],
      });
    } else if (sql.startsWith("delete from")) {
      changes = this.deleteRows(sql);
    }

    return {
      success: true,
      meta: emptyMeta(changes),
      results: [],
    };
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const sql = normalize(this.query);
    let results: Row[] = [];

    if (sql.startsWith("select linear_locked_at from sync_meta")) {
      results = this.db
        ._rows("sync_meta")
        .filter((row) => row.id === this.binds[0])
        .map(cloneRow);
    } else if (sql.startsWith("select linear_locked from sync_meta")) {
      results = this.db
        ._rows("sync_meta")
        .filter((row) => row.id === this.binds[0])
        .map(cloneRow);
    } else if (sql.startsWith("select last_linear_sync_at from sync_meta")) {
      results = this.db
        ._rows("sync_meta")
        .filter((row) => row.id === this.binds[0] || this.binds.length === 0)
        .map(cloneRow);
    } else if (sql.startsWith("select payload from workspaces")) {
      results = this.db
        ._rows("workspaces")
        .filter((row) => row.id === this.binds[0])
        .map(cloneRow);
    } else if (sql.startsWith("select 1 as ok from issues")) {
      results = this.db
        ._rows("issues")
        .filter(
          (row) =>
            row.workspace_id === this.binds[0] &&
            row.external_id === this.binds[1] &&
            (row.source === this.binds[2] || row.tag === this.binds[3])
        )
        .slice(0, 1)
        .map(() => ({ ok: 1 }));
    } else if (sql.startsWith("select external_id from ")) {
      const table = sql.match(/^select external_id from (\w+)/)?.[1] as TableName | undefined;
      if (table) {
        results = this.db
          ._rows(table)
          .filter((row) => row.workspace_id === this.binds[0] && row.source === this.binds[1])
          .map((row) => ({ external_id: row.external_id }));
      }
    } else if (sql.startsWith("select source, tag from issues")) {
      results = this.db
        ._rows("issues")
        .filter((row) => row.workspace_id === this.binds[0] && row.external_id === this.binds[1])
        .map(cloneRow);
    } else if (sql.startsWith("select source, tag from comments")) {
      results = this.db
        ._rows("comments")
        .filter((row) => row.workspace_id === this.binds[0] && row.external_id === this.binds[1])
        .map(cloneRow);
    } else if (sql.startsWith("select 1 as ok from comments")) {
      results = this.db
        ._rows("comments")
        .filter(
          (row) =>
            row.workspace_id === this.binds[0] &&
            row.external_id === this.binds[1] &&
            (row.source === this.binds[2] || row.tag === this.binds[3])
        )
        .slice(0, 1)
        .map(() => ({ ok: 1 }));
    } else if (sql.startsWith("select * from projects")) {
      results = this.db
        ._rows("projects")
        .filter((row) => row.workspace_id === this.binds[0])
        .map(cloneRow);
    } else if (sql.startsWith("select * from states")) {
      results = this.db
        ._rows("states")
        .filter((row) => row.workspace_id === this.binds[0])
        .map(cloneRow);
    } else if (sql.startsWith("select * from labels")) {
      results = this.db
        ._rows("labels")
        .filter((row) => row.workspace_id === this.binds[0])
        .map(cloneRow);
    } else if (sql.startsWith("select * from users")) {
      results = this.db
        ._rows("users")
        .filter((row) => row.workspace_id === this.binds[0])
        .map(cloneRow);
    } else if (sql.startsWith("select * from issues")) {
      results = this.db
        ._rows("issues")
        .filter((row) => row.workspace_id === this.binds[0])
        .map(cloneRow);
    } else if (sql.startsWith("select * from comments")) {
      results = this.db
        ._rows("comments")
        .filter((row) => row.workspace_id === this.binds[0])
        .map(cloneRow);
    }

    return {
      success: true,
      meta: emptyMeta(0),
      results: results as T[],
    };
  }

  async raw<T = unknown>(): Promise<[string[], ...T[]]> {
    return [[]];
  }

  private upsertUnique(table: TableName, keys: string[], row: Row): number {
    const rows = this.db._rows(table);
    const index = rows.findIndex((existing) => keys.every((key) => existing[key] === row[key]));
    if (index >= 0) {
      rows[index] = { ...rows[index], ...row };
    } else {
      rows.push(row);
    }
    return 1;
  }

  private deleteRows(sql: string): number {
    const match = sql.match(/^delete from (\w+)/);
    if (!match) return 0;
    const table = match[1] as TableName;
    const rows = this.db._rows(table);
    const before = rows.length;

    if (sql.includes("external_id in (")) {
      const drop = new Set(this.binds.slice(2).map(String));
      this.db._setRows(
        table,
        rows.filter(
          (row) =>
            !(row.workspace_id === this.binds[0] && row.source === this.binds[1] && drop.has(String(row.external_id)))
        )
      );
    } else if (sql.includes("external_id not in")) {
      const keep = new Set(this.binds.slice(2).map(String));
      this.db._setRows(
        table,
        rows.filter(
          (row) =>
            !(row.workspace_id === this.binds[0] && row.source === this.binds[1] && !keep.has(String(row.external_id)))
        )
      );
    } else if (sql.includes("and source = ?") && sql.includes("and tag = ?") && this.binds.length === 4) {
      this.db._setRows(
        table,
        rows.filter(
          (row) =>
            !(
              row.workspace_id === this.binds[0] &&
              row.source === this.binds[1] &&
              row.tag === this.binds[2] &&
              row.external_id === this.binds[3]
            )
        )
      );
    } else if (sql.includes("and source = ?") && this.binds.length === 2) {
      this.db._setRows(
        table,
        rows.filter((row) => !(row.workspace_id === this.binds[0] && row.source === this.binds[1]))
      );
    } else if (sql.includes("and source = ?") && this.binds.length === 3) {
      this.db._setRows(
        table,
        rows.filter(
          (row) =>
            !(row.workspace_id === this.binds[0] && row.source === this.binds[1] && row.external_id === this.binds[2])
        )
      );
    }

    return before - this.db._rows(table).length;
  }
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function emptyMeta(changes: number): D1Meta {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: 0,
    changed_db: changes > 0,
    changes,
  };
}
