-- D1 unified Plane + Linear storage

CREATE TABLE IF NOT EXISTS sync_meta (
  id TEXT PRIMARY KEY DEFAULT 'default',
  linear_locked INTEGER NOT NULL DEFAULT 0,
  linear_locked_at TEXT,
  last_linear_sync_at TEXT,
  last_error TEXT
);

INSERT OR IGNORE INTO sync_meta (id) VALUES ('default');

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('linear', 'plane')),
  external_id TEXT NOT NULL,
  tag TEXT NOT NULL CHECK (tag IN ('Linear', 'Plane')),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace_name ON projects (workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_projects_source ON projects (workspace_id, source);

CREATE TABLE IF NOT EXISTS states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('linear', 'plane')),
  external_id TEXT NOT NULL,
  tag TEXT NOT NULL CHECK (tag IN ('Linear', 'Plane')),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, source, project_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_states_project ON states (project_id);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('linear', 'plane')),
  external_id TEXT NOT NULL,
  tag TEXT NOT NULL CHECK (tag IN ('Linear', 'Plane')),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, source, project_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_labels_project ON labels (project_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('linear', 'plane')),
  external_id TEXT NOT NULL,
  tag TEXT NOT NULL CHECK (tag IN ('Linear', 'Plane')),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, source, external_id)
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('linear', 'plane')),
  external_id TEXT NOT NULL,
  tag TEXT NOT NULL CHECK (tag IN ('Linear', 'Plane')),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_issues_project ON issues (project_id);
CREATE INDEX IF NOT EXISTS idx_issues_workspace_name ON issues (workspace_id, project_name);
CREATE INDEX IF NOT EXISTS idx_issues_source ON issues (workspace_id, source);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('linear', 'plane')),
  external_id TEXT NOT NULL,
  tag TEXT NOT NULL CHECK (tag IN ('Linear', 'Plane')),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_comments_issue ON comments (issue_id);
