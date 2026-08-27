# Sync & Cache

## Linear webhook sync (full replace)

```
Webhook POST
  → verify signature + dedup delivery id
  → waitUntil(syncLinearToD1())
       → acquire lock (sync_meta.linear_locked)
       → fetchLinearSnapshot()
       → BEGIN batch:
            UPSERT linear projects/states/labels/users/issues/comments
            DELETE linear orphans not in snapshot
         END
       → release lock
       → kv.delete(cache keys)
```

Lock is held for the entire batch. Concurrent webhooks block on lock (existing wait/retry loop).

## Plane write

```
PATCH issue (plane source only)
  → upsert issue row (source=plane, tag=Plane)
  → kv.delete(project + workspace cache keys)
```

No Linear API calls. No background job.

## Read (cache-aside)

```
GET /issues
  → kv.get(snapshot key)
  → if miss: loadFromD1() → mergeByProjectName() → kv.put(snapshot)
  → return Plane API JSON
```

**Write-delete**: any D1 mutation deletes relevant KV keys before returning.

## Project name merge

For `GET …/projects/:projectId/issues/`:

1. Load project row → `name`
2. `SELECT id FROM projects WHERE workspace_id = ? AND name = ?`
3. `SELECT payload FROM issues WHERE project_id IN (…)`
4. Map payloads to `TIssue[]`, apply existing `filterIssues` / `buildIssuesResponse`
