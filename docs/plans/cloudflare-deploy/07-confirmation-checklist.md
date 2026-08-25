# 部署前确认清单（已归档）

> 所有项已确认。权威决策见 [09-final-decisions.md](./09-final-decisions.md)。

---

## 基础设施

| 项                | 决定                                  |
| ----------------- | ------------------------------------- |
| 域名 zone         | `delphic.studio` 在 Cloudflare        |
| Worker 域名       | `linear.delphic.studio`               |
| Pages 域名        | `dashboard.delphic.studio`            |
| Cloudflare 计划   | Free                                  |
| KV `LINEAR_CACHE` | ID `656f7304bff54deb93419c8cdef66918` |

---

## Linear

| 项                    | 决定                                                       |
| --------------------- | ---------------------------------------------------------- |
| Workspace slug        | `delphic`                                                  |
| Issue 规模            | <1k（KV 单 blob）                                          |
| `LINEAR_WORKSPACE_ID` | 不强制使用                                                 |
| 私有 Team             | 无                                                         |
| Webhook URL           | `https://linear.delphic.studio/webhooks/linear`            |
| Webhook 范围          | All public teams，一条 webhook                             |
| Resource types        | Issue, Comment, IssueLabel, IssueAttachment, Project, User |

---

## 同步与前端

| 项         | 决定                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| 主触发     | Webhook only                                                            |
| Cron 兜底  | **无**                                                                  |
| Debounce   | **30s**                                                                 |
| Cache miss | 请求内 await pull → 读 KV → 200                                         |
| 前端轮询   | **删除** `VITE_LINEAR_SYNC_POLL_INTERVAL_MS`、`use-linear-sync-refresh` |
| UI 更新    | 用户刷新页面                                                            |

---

## 密钥与 CI

| 项                         | 决定                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 存放位置                   | 全部 GitHub Secrets                                                                                               |
| 手动 `wrangler secret put` | **不需要**（CI 注入）                                                                                             |
| GitHub Secrets             | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SECRET`, `LINEAR_WORKSPACE_ID` |

---

## 实施阶段

| 阶段                       | 状态   |
| -------------------------- | ------ |
| CF-0 基础设施              | ✅     |
| CF-1 Worker + KV + Webhook | 🔄     |
| CF-3 Pages                 | 待开始 |
| CF-4 CI/CD                 | 草案   |

---

_归档于 2026-08-25。_
