# Cloudflare 部署 — 最终决策

> 单一决策记录。实施与验收以此为准。

---

## 域名与产品

| 组件           | 域名                       | Cloudflare 产品           | 源码            |
| -------------- | -------------------------- | ------------------------- | --------------- |
| Linear BFF API | `linear.delphic.studio`    | Worker                    | `apps/bff`      |
| 前端 Dashboard | `dashboard.delphic.studio` | Pages                     | `apps/web`      |
| 缓存           | —                          | Workers KV `LINEAR_CACHE` | 绑定 BFF Worker |

- `delphic.studio` zone 已在 Cloudflare
- 自定义域名在 **首次 deploy 后** 于 Dashboard 绑定（Worker / Pages 各一次）

---

## KV

| 项           | 值                                 |
| ------------ | ---------------------------------- |
| 命名空间     | `LINEAR_CACHE`                     |
| Namespace ID | `656f7304bff54deb93419c8cdef66918` |
| 分片         | 不需要（issue <1k，单 blob）       |

---

## 运行时配置

| 项                    | 值                                                   |
| --------------------- | ---------------------------------------------------- |
| Cloudflare 计划       | **Free**                                             |
| Workspace slug        | `delphic`                                            |
| `LINEAR_WORKSPACE_ID` | **不配置**                                           |
| Debounce              | **30s**                                              |
| 私有 Linear Team      | 无（Linear Free；**一条** `allPublicTeams` webhook） |

---

## 同步策略

| 触发                    | 行为                                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| `POST /webhooks/linear` | 验签 → **5s 内 200** → `ctx.waitUntil(debouncedSync)` → 全量 pull → 写 KV |
| Cache miss（读 API）    | **请求内 await** 全量 pull → 写 KV → 读 cache → **200**                   |

**不包含：**

- Cron / `scheduled()` 兜底
- 前端轮询（删除 `VITE_LINEAR_SYNC_POLL_INTERVAL_MS`、`use-linear-sync-refresh`）

Webhook 订阅：`Issue`, `Comment`, `IssueLabel`, `IssueAttachment`, `Project`, `User`；范围 `allPublicTeams: true`。

---

## 密钥与 CI

**全部** 存 GitHub Repository Secrets（用户已配置）：

| Secret                  | 用途                           |
| ----------------------- | ------------------------------ |
| `CLOUDFLARE_ACCOUNT_ID` | Wrangler account               |
| `CLOUDFLARE_API_TOKEN`  | CI 部署 Worker + Pages         |
| `LINEAR_API_KEY`        | Worker 运行时 GraphQL          |
| `LINEAR_WEBHOOK_SECRET` | Webhook HMAC 验签              |
| `LINEAR_WORKSPACE_ID`   | 已配置；运行时可选，不强制使用 |

CI workflow `.github/workflows/deploy-linear-bff.yml`：

1. `wrangler secret put`（从 GitHub Secrets 注入）
2. `wrangler deploy`

用户 **不** 手动执行 `wrangler secret put`。

GitHub Variables（非敏感）：`BFF_URL`, `PAGES_URL`, `PLANE_WORKSPACE_SLUG`, `PLANE_WORKSPACE_NAME`。

---

## 实施阶段

| 阶段 | 状态      | 内容                                    |
| ---- | --------- | --------------------------------------- |
| CF-0 | ✅ 完成   | KV、GitHub Secrets、Linear webhook      |
| CF-1 | 🔄 进行中 | Worker + KV + Webhook + cache miss 回源 |
| CF-3 | 待开始    | Pages 前端                              |
| CF-4 | 草案      | GitHub Actions（workflow 已起草）       |

CF-2（独立 Webhook 阶段）已并入 CF-1。

---

## 用户已完成 / 待办

| 已完成                              | 待办（deploy 后）                              |
| ----------------------------------- | ---------------------------------------------- |
| GitHub Secrets                      | 绑定 `linear.delphic.studio` → Worker          |
| Linear webhook → `/webhooks/linear` | 绑定 `dashboard.delphic.studio` → Pages        |
|                                     | 确认 webhook 状态 **Enabled**（Worker 上线后） |
|                                     | 验收：改 issue → 刷新页面可见更新              |

---

## 风险备忘（实施侧）

- **Free Worker CPU**：cache miss 同步 pull 可能接近 CPU 上限；冷启动失败时降级 503 + `Retry-After`（仅兜底）
- **Webhook 先于 Worker**：部署后检查 Linear webhook 未被 Disable
