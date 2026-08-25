# Cloudflare Pages 前端部署

> `apps/web` → `dashboard.delphic.studio`

---

## 1. 构建产物

| 项       | 值                           |
| -------- | ---------------------------- |
| 框架     | React Router 7，`ssr: false` |
| 构建命令 | `pnpm --filter=web build`    |
| 输出目录 | `apps/web/build/client/`     |

纯静态 SPA，**适合 Pages Direct Upload**（GitHub Actions 上传 `build/client`）。

---

## 2. 生产环境变量（构建时注入）

GitHub Variables 或 Pages Settings → Environment variables：

| 变量                         | 生产值                             | 说明                               |
| ---------------------------- | ---------------------------------- | ---------------------------------- |
| `VITE_API_BASE_URL`          | `https://linear.delphic.studio`    | BFF 根 URL，**无尾部斜杠**         |
| `VITE_WEB_BASE_URL`          | `https://dashboard.delphic.studio` | 前端自身 URL                       |
| `VITE_LINEAR_DISPLAY_MODE`   | `true`                             | 启用 Linear 只读模式               |
| `VITE_LINEAR_WORKSPACE_SLUG` | `delphic`                          | 与 BFF `PLANE_WORKSPACE_SLUG` 一致 |

**不要设置** `VITE_*` 形式的 Linear API Key。  
**不配置** `VITE_LINEAR_SYNC_POLL_INTERVAL_MS`（已删除前端轮询；数据由 Webhook + 用户刷新驱动）。

---

## 3. SPA 路由（必须）

**新建** `apps/web/public/_redirects`：

```
/*    /index.html   200
```

---

## 4. 自定义域名 `dashboard.delphic.studio`

1. Cloudflare Dashboard → **Workers & Pages** → Pages 项目 `delphic-dashboard`
2. **Custom domains** → Add → `dashboard.delphic.studio`
3. 等待 SSL Active

- 前端：`dashboard.delphic.studio`
- API：`linear.delphic.studio`（跨子域，依赖 BFF CORS）

---

## 5. Service Worker 注意

`apps/web/public/sw.js` 存在。确认不缓存 `linear.delphic.studio` API 响应；部署后硬刷新验证 issues 列表更新。

---

## 6. 本地与生产对照

| 项       | 本地                                | 生产                               |
| -------- | ----------------------------------- | ---------------------------------- |
| 前端 URL | `http://localhost:3000`             | `https://dashboard.delphic.studio` |
| BFF URL  | `http://localhost:8000`             | `https://linear.delphic.studio`    |
| CORS     | `CORS_ORIGIN=http://localhost:3000` | `https://dashboard.delphic.studio` |

---

## 7. Pages 项目设置建议

| 设置                   | 值                      |
| ---------------------- | ----------------------- |
| Build output directory | `apps/web/build/client` |
| Node version           | 22                      |

**推荐**：与 BFF 一致使用 **GitHub Actions Direct Upload**。

---

## 8. 部署后验收

1. 打开 `https://dashboard.delphic.studio/delphic/`
2. 侧边栏加载项目列表；打开 Issues
3. DevTools Network：API 指向 `linear.delphic.studio`，无 CORS 错误
4. 在 Linear 修改 issue → 等待 debounce（~30s）→ **刷新页面**可见更新
