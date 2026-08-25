# GitHub Actions CI/CD

> 敏感信息存 GitHub Secrets；CI 部署时注入 Worker Secrets 并 deploy。密钥不入仓库。

---

## 1. 密钥模型

| 存放                       | 内容                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **GitHub Secrets**         | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SECRET`, `LINEAR_WORKSPACE_ID` |
| **GitHub Variables**       | `BFF_URL`, `PAGES_URL`, `PLANE_WORKSPACE_SLUG`, `PLANE_WORKSPACE_NAME`                                            |
| **wrangler.toml `[vars]`** | `CORS_ORIGIN`, slug, `SYNC_DEBOUNCE_MS` 等非敏感项                                                                |

CI workflow 在 `wrangler deploy` 前执行 `wrangler secret put`（从 GitHub Secrets 读取）。用户无需手动 `wrangler secret put`。

---

## 2. GitHub 配置

### Secrets

| Name                    | 用途                  |
| ----------------------- | --------------------- |
| `CLOUDFLARE_API_TOKEN`  | 部署 Worker + Pages   |
| `CLOUDFLARE_ACCOUNT_ID` | Wrangler account      |
| `LINEAR_API_KEY`        | Worker 运行时 GraphQL |
| `LINEAR_WEBHOOK_SECRET` | Webhook HMAC          |
| `LINEAR_WORKSPACE_ID`   | 可选校验              |

API Token 权限：Workers Scripts Edit、KV Edit、Pages Edit。

### Variables

| Name                   | 值                                 |
| ---------------------- | ---------------------------------- |
| `BFF_URL`              | `https://linear.delphic.studio`    |
| `PAGES_URL`            | `https://dashboard.delphic.studio` |
| `PLANE_WORKSPACE_SLUG` | `delphic`                          |
| `PLANE_WORKSPACE_NAME` | `Delphic Arcana Collective`        |

---

## 3. Workflows

| 文件                                      | 触发                 | 目标                      |
| ----------------------------------------- | -------------------- | ------------------------- |
| `.github/workflows/deploy-linear-bff.yml` | `push` `apps/bff/**` | Worker `linear-bff`       |
| `.github/workflows/deploy-dashboard.yml`  | `push` `apps/web/**` | Pages `delphic-dashboard` |

---

## 4. Worker 部署 Workflow

```yaml
# .github/workflows/deploy-linear-bff.yml
name: Deploy Linear BFF (Worker)

on:
  push:
    branches: [preview, main]
    paths:
      - "apps/bff/**"
      - "packages/types/**"
      - "pnpm-lock.yaml"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11.3.0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run build --filter=bff --filter=@plane/types

      - name: Put Worker secrets
        working-directory: apps/bff
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          echo "${{ secrets.LINEAR_API_KEY }}" | npx wrangler secret put LINEAR_API_KEY
          echo "${{ secrets.LINEAR_WEBHOOK_SECRET }}" | npx wrangler secret put LINEAR_WEBHOOK_SECRET
          if [ -n "${{ secrets.LINEAR_WORKSPACE_ID }}" ]; then
            echo "${{ secrets.LINEAR_WORKSPACE_ID }}" | npx wrangler secret put LINEAR_WORKSPACE_ID
          fi

      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/bff
          command: deploy
```

---

## 5. Pages 部署 Workflow

```yaml
# .github/workflows/deploy-dashboard.yml
name: Deploy Dashboard (Pages)

on:
  push:
    branches: [preview, main]
    paths:
      - "apps/web/**"
      - "packages/**"
      - "pnpm-lock.yaml"
  workflow_dispatch:

permissions:
  contents: read
  deployments: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11.3.0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Build web
        run: pnpm turbo run build --filter=web
        env:
          VITE_API_BASE_URL: ${{ vars.BFF_URL }}
          VITE_WEB_BASE_URL: ${{ vars.PAGES_URL }}
          VITE_LINEAR_DISPLAY_MODE: "true"
          VITE_LINEAR_WORKSPACE_SLUG: ${{ vars.PLANE_WORKSPACE_SLUG }}

      - name: Deploy Pages
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy apps/web/build/client --project-name=delphic-dashboard --branch=${{ github.ref_name }}
```

---

## 6. 安全检查

- [ ] `.gitignore` 含 `.dev.vars`、`apps/bff/.env`
- [ ] CI 不 `echo` secrets
- [ ] `wrangler.toml` 无 API Key
- [ ] 前端无 `VITE_LINEAR_API_KEY`
- [ ] Fork PR workflow 不暴露 secrets

---

## 7. 分支策略

| 分支      | Worker               | Pages                       |
| --------- | -------------------- | --------------------------- |
| `main`    | `linear-bff`         | `delphic-dashboard`         |
| `preview` | `linear-bff-preview` | `delphic-dashboard-preview` |

---

## 8. 部署后 Smoke Test（可选）

```yaml
- run: |
    curl -sf "https://linear.delphic.studio/health" | jq -e '.cache.ready'
    curl -sf "https://linear.delphic.studio/api/instances/"
```

---

## 参考

- [Cloudflare Workers + GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [wrangler-action](https://github.com/cloudflare/wrangler-action)
