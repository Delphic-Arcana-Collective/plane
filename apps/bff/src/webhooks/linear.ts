import type { KvCacheBackend } from "../cache/backend.js";
import type { Env } from "../env.js";
import { scheduleDebouncedSync } from "../sync/debounce.js";

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

  scheduleDebouncedSync(env, cache, ctx, "webhook");

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
