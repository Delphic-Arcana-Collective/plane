# D1 Unified Issues Storage — Refactor Plan

## Goal

Replace the KV snapshot + in-memory navigation model with **Cloudflare D1** as the durable store. Plane and Linear issues live in one schema, distinguished by `source`. The UI merges issues for projects that share the same **display name**.

## Branch layout

| Branch                                 | Purpose                                               |
| -------------------------------------- | ----------------------------------------------------- |
| `ref/preview-linear-navigation-backup` | Previous Linear navigation / KV work (reference only) |
| `refactor/d1-unified-issues-storage`   | New work on pre-azusayn Plane baseline (`1d0ee2482`)  |

## Data model

- **`source`**: `linear` \| `plane` — never mix writes across sources.
- **System tags** (readonly): `Linear`, `Plane` — attached to every row; Plane APIs must not delete `Linear`-tagged data.
- **Single `issues` table** (and related tables) with `source` + `external_id` unique per workspace.
- **Project aggregation**: queries resolve `project_id → project.name`, then include all issues whose project shares that name (both sources).

## Write paths

### Plane (priority)

1. Validate payload; reject deletes targeting `source = linear`.
2. `INSERT … ON CONFLICT DO UPDATE` into D1 (`source = plane`, tag `Plane`).
3. **Write-invalidate**: delete KV cache keys for workspace / project (no stale reads).

### Linear (webhook only)

Triggered on the same Linear webhook events as today — **no background sync worker**.

1. Acquire D1 sync lock (`sync_meta.linear_locked = 1`).
2. Full fetch from Linear API.
3. In one D1 batch (lock held):
   - Upsert all Linear projects, states, labels, users, issues, comments (`source = linear`, tag `Linear`).
   - `ON CONFLICT` updates every column from the Linear payload.
   - Delete Linear rows whose `external_id` is absent from the snapshot (orphan purge).
4. Release lock.
5. Invalidate KV cache.

Linear data in Plane must mirror Linear exactly. Plane data is never pushed to Linear.

## Read path (cache-aside)

1. Try KV assembled snapshot (`cache:snapshot:{workspace}`).
2. On miss: load from D1, merge projects by name, build `PlaneCache`, write KV.
3. Return to existing Plane API response shape (mapper unchanged).

## UI

- Plane web runs in Linear display mode (BFF base URL).
- Project issue list shows **Linear + Plane** issues for the same project name.
- Plane mutations go through BFF → D1 only; Linear remains read-only in UI.

## Testing

| Layer                | Command                                                        |
| -------------------- | -------------------------------------------------------------- |
| Unit / API           | `pnpm --filter=bff test`                                       |
| Navigation stress    | `pnpm --filter=bff test:navigation-stress`                     |
| Browser smoke        | `pnpm --filter=bff test:browser`                               |
| Remote (Windows LAN) | `pnpm --filter=bff test:navigation-prod-stress` with `WEB_URL` |

Run API tests with concurrency where the host allows; cap parallel browsers if the machine struggles.

## Deploy

1. `wrangler d1 migrations apply plane-unified --remote`
2. `pnpm --filter=bff deploy:worker`
3. Redeploy web with `VITE_LINEAR_DISPLAY_MODE=true` and BFF URL.

See [01-schema.md](./01-schema.md), [02-sync-and-cache.md](./02-sync-and-cache.md), [03-rollout.md](./03-rollout.md).
