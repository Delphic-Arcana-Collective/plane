# BFF 移植 Cloudflare Worker + KV

> 将 `apps/bff` 从 Node 长进程改为 Worker 无状态 + `LINEAR_CACHE` KV。

---

## 1. 当前代码可复用部分

| 模块           | 路径                       | Worker 适配                           |
| -------------- | -------------------------- | ------------------------------------- |
| Hono 路由      | `routes/*`                 | ✅ 直接复用                           |
| Linear GraphQL | `linear/client.ts`         | ✅ 使用 `fetch`，已兼容               |
| 映射层         | `mapper/index.ts`          | ✅ 复用（`marked` 需验证）            |
| 测试           | `tests/api.routes.test.ts` | ✅ `app.request()` 模式与 Worker 一致 |
| 内存缓存       | `cache/store.ts`           | ❌ 需 KV 后端                         |
| 后台轮询       | `linear/worker.ts`         | ❌ 改为 Webhook / cache-miss 调用     |
| Node 入口      | `index.ts`, `server.ts`    | ❌ 拆分 Worker / Node 双入口          |

---

## 2. 核心改造：CacheBackend 抽象

```typescript
interface CacheBackend {
  getMeta(): Promise<CacheMeta | null>;
  loadSnapshot(): Promise<PlaneCacheSnapshot | null>;
  saveSnapshot(snapshot: LinearSyncSnapshot, mapped: MappedCache): Promise<void>;
  getUserProperties(projectId: string): Promise<UserProperties | null>;
  setUserProperties(projectId: string, props: UserProperties): Promise<void>;
}
```

| 实现                 | 用途                              |
| -------------------- | --------------------------------- |
| `MemoryCacheBackend` | 单元测试、本地 `pnpm dev`（Node） |
| `KvCacheBackend`     | 生产 Worker，`env.LINEAR_CACHE`   |

`createServer(env, cacheBackend)` 注入依赖，替代全局 `cacheStore` 单例。

---

## 3. Worker 入口草图

```typescript
// apps/bff/src/worker-entry.ts
export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const appEnv = loadEnvFromBindings(env);
    const cache = new KvCacheBackend(env.LINEAR_CACHE);

    const url = new URL(request.url);
    if (url.pathname === "/webhooks/linear" && request.method === "POST") {
      return handleLinearWebhook(request, appEnv, cache, ctx);
    }

    const app = createServer(appEnv, cache);
    return app.fetch(request, env, ctx);
  },
};
```

---

## 4. `env.ts` 改造

- Worker：从 `c.env` / `bindings` 读取
- Node 本地：`loadEnv()` 继续读 `process.env`（`.env` / `.dev.vars`）

| 变量                    | 默认    | 说明                   |
| ----------------------- | ------- | ---------------------- |
| `LINEAR_WEBHOOK_SECRET` | —       | Webhook HMAC           |
| `SYNC_DEBOUNCE_MS`      | `30000` | Webhook 合并窗口       |
| `SYNC_MIN_INTERVAL_MS`  | `30000` | 两次全量 pull 最小间隔 |

---

## 5. `wrangler.toml` 示例

```toml
name = "linear-bff"
main = "src/worker-entry.ts"
compatibility_date = "2026-08-25"
compatibility_flags = ["nodejs_compat"]

[vars]
CORS_ORIGIN = "https://dashboard.delphic.studio"
PLANE_WORKSPACE_SLUG = "delphic"
PLANE_WORKSPACE_NAME = "Delphic Arcana Collective"
SYNC_DEBOUNCE_MS = "30000"
SYNC_MIN_INTERVAL_MS = "30000"

[[kv_namespaces]]
binding = "LINEAR_CACHE"
id = "656f7304bff54deb93419c8cdef66918"
```

### 密钥与 CI

Secrets **不**写入 toml，**不**手动 `wrangler secret put`。

`.github/workflows/deploy-linear-bff.yml`：

1. `wrangler secret put LINEAR_API_KEY`（从 GitHub Secrets）
2. `wrangler secret put LINEAR_WEBHOOK_SECRET`
3. `wrangler deploy`

本地开发：复制 `apps/bff/.dev.vars.example` → `.dev.vars`（gitignore）。

---

## 6. `runSync` 逻辑（从 `linear/worker.ts` 抽出）

保留：单飞锁、重试 3 次 + 指数退避、`fetchLinearSnapshot` → map → `saveSnapshot`、错误写入 `meta.error`。

移除：`setInterval` / `startWorker` / `stopWorker`。

---

## 7. `requireCache` 与 cache miss 回源

Cache miss 时 **请求内 await** 全量 pull，写 KV，再返回 200：

```typescript
if (!ready && env.LINEAR_API_KEY) {
  await runSync(env, cache, { reason: "cache-miss" });
  // 重新 load snapshot → 200
}
// 仅 CPU 超限等兜底：503 + Retry-After
```

---

## 8. 文件级改动清单

| 文件                                    | 操作                                    |
| --------------------------------------- | --------------------------------------- |
| `cache/backend.ts`, `cache/kv-store.ts` | **新增**                                |
| `cache/store.ts`                        | 重构为 `MemoryCacheBackend`             |
| `sync/run-sync.ts`, `sync/debounce.ts`  | **新增**                                |
| `webhooks/linear.ts`                    | **新增** `POST /webhooks/linear`        |
| `worker-entry.ts`, `wrangler.toml`      | **新增**                                |
| `env.ts`, `server.ts`, `index.ts`       | 双模式 load / 注入 cacheBackend         |
| `package.json`                          | 添加 `wrangler` devDep；`deploy` script |

---

## 9. 本地开发双模式

| 模式         | 命令                          | 缓存                     |
| ------------ | ----------------------------- | ------------------------ |
| Node（现有） | `cd apps/bff && pnpm dev`     | 内存                     |
| Worker 仿真  | `cd apps/bff && wrangler dev` | 本地 KV 仿真 / remote KV |

---

## 10. 风险与缓解

| 风险                             | 缓解                                  |
| -------------------------------- | ------------------------------------- |
| 全量 sync 超 CPU（Free）         | cache miss 失败时 503 + `Retry-After` |
| KV 25MB 超限                     | 按 project 分片 issues                |
| user-properties PATCH 跨 isolate | 写 KV                                 |
| Webhook 并发                     | KV 单飞锁                             |
