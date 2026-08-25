# Cloudflare 部署 — 用户操作清单

> 你已完成的配置与 deploy 后剩余步骤。技术决策见 [09-final-decisions.md](./09-final-decisions.md)。

---

## 已完成 ✅

| 项                    | 值 / 状态                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `delphic.studio` zone | Cloudflare                                                                                                        |
| KV `LINEAR_CACHE`     | ID `656f7304bff54deb93419c8cdef66918`                                                                             |
| Cloudflare 计划       | Free                                                                                                              |
| GitHub Secrets        | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SECRET`, `LINEAR_WORKSPACE_ID` |
| Linear webhook        | `https://linear.delphic.studio/webhooks/linear`，All public teams                                                 |
| Workspace slug        | `delphic`                                                                                                         |

CI 负责 `wrangler deploy` + `wrangler secret put`；**无需**本机手动操作。

### Cloudflare API Token 权限（若 CI 报 `Authentication error [code: 10000]`）

编辑 Token 时勾选：

- Account → **Workers Scripts** → Edit
- Account → **Workers KV Storage** → Edit
- Account → **Cloudflare Pages** → Edit
- Account → **Account Settings** → Read
- User → **Memberships** → Read

若新建了 Token，需更新 GitHub Secret `CLOUDFLARE_API_TOKEN`。

若 secret 同步仍失败，可临时在 Dashboard → Worker `linear-bff` → Settings → Variables 手动添加 `LINEAR_API_KEY` 与 `LINEAR_WEBHOOK_SECRET`。

---

## Deploy 后待办 ⬜

### 1. Worker 域名 `linear.delphic.studio`

1. Dashboard → **Workers & Pages** → Worker `linear-bff`
2. **Settings** → **Domains & Routes** → **Add Custom Domain** → `linear.delphic.studio`
3. 等待 SSL **Active**

### 2. Pages 域名 `dashboard.delphic.studio`

1. Dashboard → Pages 项目 `delphic-dashboard`
2. **Custom domains** → `dashboard.delphic.studio`
3. 等待 SSL **Active**

Cloudflare 会自动在 `delphic.studio` zone 添加 DNS，无需手动 CNAME。

### 3. 验证 Linear webhook

1. Linear → Settings → API → Webhooks → 状态 **Enabled**（若曾 Disabled 则重新启用）
2. 改一条 issue → Worker Logs 出现 sync
3. `GET https://linear.delphic.studio/health` → `cache.ready: true`

### 4. 端到端验收

- [ ] `GET https://linear.delphic.studio/api/instances/` → 200
- [ ] `https://dashboard.delphic.studio/delphic/` 可浏览 issues
- [ ] 改 Linear issue → 等 debounce（≤30s）→ **刷新页面** 可见更新

---

## GitHub Variables（非敏感）

| Name                   | 值                                 |
| ---------------------- | ---------------------------------- |
| `BFF_URL`              | `https://linear.delphic.studio`    |
| `PAGES_URL`            | `https://dashboard.delphic.studio` |
| `PLANE_WORKSPACE_SLUG` | `delphic`                          |
| `PLANE_WORKSPACE_NAME` | `Delphic Arcana Collective`        |

---

## 本地开发（开发方）

```bash
cd apps/bff
cp .dev.vars.example .dev.vars   # 填入 LINEAR_API_KEY 等，勿提交
npx wrangler dev
curl http://localhost:8787/health
```

---

## 安全提醒

- 勿将 API Key、Webhook Secret、CF Token 写入 git 或 PR
- 勿在前端 `VITE_*` 中放 Linear 凭证
- Token 泄露后立即在 Cloudflare / Linear 轮换
