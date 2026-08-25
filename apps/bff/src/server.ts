import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { CacheBackend } from "./cache/backend.js";
import { MemoryCacheBackend } from "./cache/store.js";
import type { Env } from "./env.js";
import { startWorker } from "./linear/worker.js";
import { createRoutes } from "./routes/index.js";

declare module "hono" {
  interface ContextVariableMap {
    env: Env;
    cache: CacheBackend;
  }
}

export function createServer(env: Env, cacheBackend: CacheBackend) {
  const app = new Hono();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    })
  );
  app.use("*", async (c, next) => {
    c.set("env", env);
    c.set("cache", cacheBackend);
    await cacheBackend.ensureLoaded();
    c.header("Cache-Control", "no-store");
    await next();
  });

  app.route("/", createRoutes());

  return app;
}

export function startServer(env: Env) {
  const cache = new MemoryCacheBackend();
  const app = createServer(env, cache);

  startWorker(env, cache);

  serve(
    {
      fetch: app.fetch,
      port: env.BFF_PORT,
    },
    (info) => {
      console.log(`[bff] listening on http://localhost:${info.port}`);
      console.log(`[bff] workspace slug: ${env.PLANE_WORKSPACE_SLUG}`);
      if (!env.LINEAR_API_KEY) {
        console.log("[bff] Phase 0 mock mode — LINEAR_API_KEY not set");
      }
    }
  );

  return app;
}
