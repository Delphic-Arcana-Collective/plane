# D1 Schema

## Tables

### `sync_meta` (singleton)

| Column                | Type    | Notes                          |
| --------------------- | ------- | ------------------------------ |
| `id`                  | TEXT PK | always `'default'`             |
| `linear_locked`       | INTEGER | 1 while webhook full-sync runs |
| `linear_locked_at`    | TEXT    | ISO timestamp                  |
| `last_linear_sync_at` | TEXT    |                                |
| `last_error`          | TEXT    |                                |

### `webhook_deliveries`

Dedup Linear webhook delivery ids (unchanged behaviour).

### `workspaces`

Workspace metadata (`slug`, `name`).

### `projects`

| Column         | Notes                   |
| -------------- | ----------------------- |
| `id`           | Plane-facing project id |
| `workspace_id` |                         |
| `name`         | **Aggregation key**     |
| `source`       | `linear` \| `plane`     |
| `external_id`  | id in source system     |
| `payload`      | JSON `TPartialProject`  |

Unique: `(workspace_id, source, external_id)`

### `issues`

| Column         | Notes                                     |
| -------------- | ----------------------------------------- |
| `id`           | `{source}:{external_id}`                  |
| `workspace_id` |                                           |
| `project_id`   | FK to `projects.id`                       |
| `project_name` | denormalized for aggregation              |
| `source`       | `linear` \| `plane`                       |
| `external_id`  |                                           |
| `tag`          | `Linear` or `Plane` (readonly system tag) |
| `payload`      | JSON `TIssue`                             |
| `updated_at`   |                                           |

Unique: `(workspace_id, source, external_id)`

### `comments`, `states`, `labels`, `users`

Same `source` + `external_id` pattern; `payload` holds the Plane-shaped JSON.

## Invariants

1. `DELETE … WHERE source = 'linear'` only inside locked webhook sync.
2. Plane write handlers reject `source = linear` mutations and any delete of `tag = 'Linear'`.
3. Orphan purge applies only to `source = 'linear'` after a full snapshot.
