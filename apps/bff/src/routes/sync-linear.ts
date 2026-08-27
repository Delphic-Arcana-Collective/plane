import { Hono } from "hono";
import { runSync } from "../sync/run-sync.js";
import { getCache } from "./helpers.js";

const SYNC_SECRET_HEADER = "X-Sync-Secret";

export function createSyncLinearRoutes() {
  const app = new Hono();

  app.post("/internal/sync-linear", async (c) => {
    const secret = c.req.header(SYNC_SECRET_HEADER);
    const expected = c.get("env").LINEAR_WEBHOOK_SECRET;
    if (!expected || secret !== expected) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const result = await runSync(c.get("env"), getCache(c), { reason: "admin-sync" });
    return c.json({ result });
  });

  return app;
}
