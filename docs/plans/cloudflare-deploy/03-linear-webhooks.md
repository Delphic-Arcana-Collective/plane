# Linear Webhook 同步方案

> Webhook 驱动全量 pull；cache miss 时请求内回源。无 Cron、无前端轮询。

---

## 1. 设计目标

| 目标      | 说明                                    |
| --------- | --------------------------------------- |
| 事件驱动  | Linear 上任何**非只读**变更触发缓存更新 |
| 全量 pull | 复用 `fetchLinearSnapshot()`，写入 KV   |
| 快速响应  | **5 秒内 HTTP 200**（Linear 硬性要求）  |
| 防抖      | **30s** 内多次事件合并为一次 sync       |
| 幂等      | `Linear-Delivery` UUID 去重             |

---

## 2. 订阅的事件类型

```json
["Issue", "Comment", "IssueLabel", "IssueAttachment", "Project", "User"]
```

| 类型              | 动作                     | 对应 Plane 数据                  |
| ----------------- | ------------------------ | -------------------------------- |
| `Issue`           | create / update / remove | 工单主体、状态、指派人、due date |
| `Comment`         | create / update / remove | 评论线程                         |
| `IssueLabel`      | create / update / remove | 标签定义                         |
| `IssueAttachment` | create / update / remove | 附件                             |
| `Project`         | create / update / remove | 项目列表                         |
| `User`            | create / update / remove | 用户显示名                       |

**不订阅**：`Reaction`, `IssueSLA`, `Cycle`, `Document`, `Initiative` 等。

---

## 3. Webhook 范围

| 模式          | 配置                       | 覆盖                                |
| ------------- | -------------------------- | ----------------------------------- |
| 全部公开 Team | `allPublicTeams: true`     | 组织内所有公开 team（**当前采用**） |
| 私有 Team     | 每个私有 team 单独 webhook | `allPublicTeams` 不包含私有 team    |

Linear Free；无私有 Team → **一条** `allPublicTeams: true` webhook。

---

## 4. 端点设计

```
POST https://linear.delphic.studio/webhooks/linear
```

### 处理流程

```
1. 读取 raw body（验签前不能 JSON.parse）
2. 验证 Linear-Signature（HMAC-SHA256，hex）
3. 验证 webhookTimestamp（|now - ts| < 60s，防重放）
4. 检查 Linear-Delivery 是否已处理（KV 24h TTL）
5. 立即返回 200 { "ok": true }
6. ctx.waitUntil(scheduleDebouncedSync())  // debounce 30s → runSync
```

### 相关 HTTP Headers

| Header             | 用途                 |
| ------------------ | -------------------- |
| `Linear-Signature` | HMAC 签名            |
| `Linear-Delivery`  | 幂等 ID（重试相同）  |
| `Linear-Event`     | 实体类型，如 `Issue` |
| `Linear-Timestamp` | 发送时间 ms          |

---

## 5. Debounce 与单飞锁

KV keys：

| Key                       | 值            | TTL           |
| ------------------------- | ------------- | ------------- |
| `sync:scheduled_at`       | ISO timestamp | debounce 窗口 |
| `sync:in_progress`        | `"1"`         | 300s          |
| `sync:last_completed_at`  | ISO timestamp | —             |
| `webhook:delivery:{uuid}` | `"1"`         | 86400s        |

逻辑：Webhook 到达 → debounce 30s → 获取单飞锁 → `runSync()` → 释放锁。同步进行中忽略重复 webhook。

---

## 6. 全量 pull vs 增量

Phase 1 采用**全量 pull**（与现网一致）；忽略 webhook payload 的 `data` 字段。

---

## 7. Linear API 速率限制

| 限制    | 值                        |
| ------- | ------------------------- |
| API Key | **2,500 requests / hour** |
| 复杂度  | 3M points / hour          |

`SYNC_DEBOUNCE_MS=30000`，`SYNC_MIN_INTERVAL_MS=30000`。遇 `RATELIMITED` 延长 debounce。

---

## 8. Linear 后台注册步骤

1. 部署 Worker 且 `POST /webhooks/linear` 可从公网访问
2. [Linear Settings → API](https://linear.app/settings/api) → **New webhook**
3. URL：`https://linear.delphic.studio/webhooks/linear`
4. Scope：**All Public Teams**
5. Resource types：Issue, Comment, IssueLabel, IssueAttachment, Project, User
6. Signing secret → 存入 GitHub Secret `LINEAR_WEBHOOK_SECRET`（CI 注入 Worker）
7. 创建测试 issue，检查 KV `meta.lastFetchedAt`

---

## 9. 失败与重试

| 行为          | Linear 侧                                   |
| ------------- | ------------------------------------------- |
| 非 2xx 或 >5s | 重试 3 次：1min → 1h → 6h                   |
| 持续失败      | Webhook 可能被 **自动禁用**，需 UI 重新启用 |

**Worker 必须始终尽快 200**；sync 失败只写 `meta.error`，不返回 5xx 给 Linear。

---

## 10. 所需密钥

| 变量                    | 来源                        |
| ----------------------- | --------------------------- |
| `LINEAR_WEBHOOK_SECRET` | 创建 webhook 时 Linear 返回 |
| `LINEAR_API_KEY`        | 已有；用于 pull             |

两者存 GitHub Secrets → CI `wrangler secret put` → Worker runtime。不入 git。
