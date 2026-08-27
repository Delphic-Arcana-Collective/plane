# Rollout & Remote Testing

## Local

```bash
cd apps/bff
cp .dev.vars.example .dev.vars   # LINEAR_API_KEY, LINEAR_WEBHOOK_SECRET
pnpm dev:worker                  # D1 local + KV local
pnpm test
```

## Create remote D1 (once)

```bash
wrangler d1 create plane-unified
# paste database_id into wrangler.toml
wrangler d1 migrations apply plane-unified --remote
```

## Windows LAN test host

Set in environment or `.env`:

- `WEB_URL` — deployed dashboard URL
- `CHROME_PATH` — Chrome on Windows
- `PARALLEL` — start at `1`, increase if stable

```powershell
$env:PARALLEL=1; $env:ROUNDS=20; pnpm --filter=bff test:navigation-prod-stress
```

## Deploy sequence

1. Apply D1 migrations (remote)
2. Deploy Worker (`deploy:worker`)
3. Trigger one Linear webhook or manual sync to seed Linear rows
4. Deploy web with Linear display mode env vars
5. Run stress + browser tests on LAN host
6. Fix → redeploy until green
