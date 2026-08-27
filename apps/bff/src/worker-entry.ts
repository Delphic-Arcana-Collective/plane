import { createServer } from "./server.js";
import { createCacheBackend } from "./cache/d1-kv-backend.js";
import { loadEnvFromBindings, type CloudflareEnv } from "./env.js";
import { handleLinearWebhook } from "./webhooks/linear.js";

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const appEnv = loadEnvFromBindings(env);
    const cache = createCacheBackend(env.PLANE_DB, env.LINEAR_CACHE);

    const url = new URL(request.url);
    if (url.pathname === "/webhooks/linear") {
      return handleLinearWebhook(request, appEnv, cache, ctx);
    }

    const app = createServer(appEnv, cache);
    return app.fetch(request, env, ctx);
  },
};
