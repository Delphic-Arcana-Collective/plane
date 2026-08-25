import type { KvCacheBackend } from "../cache/backend.js";
import type { Env } from "../env.js";
import { runSync } from "../sync/run-sync.js";

const SIGNATURE_HEADER = "Linear-Signature";
const DELIVERY_HEADER = "Linear-Delivery";
const TIMESTAMP_HEADER = "Linear-Timestamp";
const MAX_TIMESTAMP_SKEW_MS = 60_000;

export async function verifyLinearWebhookSignature(
  rawBody: string,
  secret: string,
  signatureHeader: string | null
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = bufferToHex(digest);

  return timingSafeEqual(expected, signatureHeader);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function isTimestampFresh(timestampHeader: string | null): boolean {
  if (!timestampHeader) return true;
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;
  return Math.abs(Date.now() - timestamp) <= MAX_TIMESTAMP_SKEW_MS;
}

async function waitForWebhookSync(env: Env, cache: KvCacheBackend, attempt = 0): Promise<void> {
  if (attempt >= 20) {
    console.error("[bff] Webhook sync gave up after waiting for in-progress sync");
    return;
  }

  const result = await runSync(env, cache, { reason: "webhook" });
  if (result === "completed" || result === "failed") return;

  await new Promise((resolve) => setTimeout(resolve, 2000));
  return waitForWebhookSync(env, cache, attempt + 1);
}

export async function handleLinearWebhook(
  request: Request,
  env: Env,
  cache: KvCacheBackend,
  ctx: ExecutionContext
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!env.LINEAR_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Webhook secret not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawBody = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER);
  const valid = await verifyLinearWebhookSignature(rawBody, env.LINEAR_WEBHOOK_SECRET, signature);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isTimestampFresh(request.headers.get(TIMESTAMP_HEADER))) {
    return new Response(JSON.stringify({ error: "Stale webhook timestamp" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const deliveryId = request.headers.get(DELIVERY_HEADER);
  if (deliveryId) {
    const isNew = await cache.markWebhookDeliveryProcessed(deliveryId);
    if (!isNew) {
      return new Response(JSON.stringify({ ok: true, deduped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  ctx.waitUntil(
    waitForWebhookSync(env, cache).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[bff] Webhook sync failed:", message);
    })
  );

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
