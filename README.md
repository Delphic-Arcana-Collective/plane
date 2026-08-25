# Plane × Linear (read-only)

Fork of [Plane](https://github.com/makeplane/plane) (AGPL-3.0). Plane provides the web UI; [`apps/bff`](apps/bff) syncs **Linear** into memory and exposes Plane-compatible **read-only** APIs. No Django or Postgres needed for local dev.

## Prerequisites

- Node.js + [pnpm](https://pnpm.io/)
- Linear API key

## Setup

```bash
pnpm install

cp apps/bff/.env.example apps/bff/.env
cp apps/web/.env.example apps/web/.env
```

Fill in:

| File            | Required                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `apps/bff/.env` | `LINEAR_API_KEY`, `PLANE_WORKSPACE_SLUG`, `PLANE_WORKSPACE_NAME`                                                     |
| `apps/web/.env` | `VITE_API_BASE_URL=http://localhost:8000`, `VITE_LINEAR_DISPLAY_MODE=true`, `VITE_LINEAR_WORKSPACE_SLUG` (same slug) |

Optional: `LINEAR_WORKSPACE_ID` (org UUID), `CACHE_POLL_INTERVAL_MS` (default 3000). Env is read from `.env` at startup, not from shell commands.

## Run

```bash
# Terminal 1 — BFF :8000
cd apps/bff && pnpm dev

# Terminal 2 — Web :3000
pnpm --filter=web dev
```

Open `http://localhost:3000/<workspace-slug>/`.

## Build & test

```bash
pnpm --filter=bff build
pnpm --filter=bff test
pnpm check          # format, lint, types (whole monorepo)
```
