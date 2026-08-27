-- States/labels are team-scoped in Linear but attached per Plane project.
-- Unique on (workspace, source, external_id) caused last project to overwrite others.

CREATE TABLE states_new (
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

INSERT OR IGNORE INTO states_new
  SELECT id, workspace_id, project_id, source, external_id, tag, payload, updated_at FROM states;

DROP TABLE states;
ALTER TABLE states_new RENAME TO states;
CREATE INDEX IF NOT EXISTS idx_states_project ON states (project_id);

CREATE TABLE labels_new (
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

INSERT OR IGNORE INTO labels_new
  SELECT id, workspace_id, project_id, source, external_id, tag, payload, updated_at FROM labels;

DROP TABLE labels;
ALTER TABLE labels_new RENAME TO labels;
CREATE INDEX IF NOT EXISTS idx_labels_project ON labels (project_id);
