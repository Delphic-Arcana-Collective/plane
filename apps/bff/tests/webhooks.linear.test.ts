import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLinearWebhookSignature } from "../src/webhooks/linear.js";

const TEST_SECRET = "test-webhook-secret";
const TEST_PAYLOAD = JSON.stringify({
  action: "update",
  type: "Issue",
  data: { id: "issue-1" },
});

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

describe("Linear webhook signature verification", () => {
  it("accepts a valid HMAC-SHA256 signature", async () => {
    const signature = signPayload(TEST_PAYLOAD, TEST_SECRET);
    await expect(verifyLinearWebhookSignature(TEST_PAYLOAD, TEST_SECRET, signature)).resolves.toBe(true);
  });

  it("rejects an invalid signature", async () => {
    await expect(verifyLinearWebhookSignature(TEST_PAYLOAD, TEST_SECRET, "deadbeef")).resolves.toBe(false);
  });

  it("rejects when the secret is missing", async () => {
    const signature = signPayload(TEST_PAYLOAD, TEST_SECRET);
    await expect(verifyLinearWebhookSignature(TEST_PAYLOAD, "", signature)).resolves.toBe(false);
  });

  it("rejects when the signature header is missing", async () => {
    await expect(verifyLinearWebhookSignature(TEST_PAYLOAD, TEST_SECRET, null)).resolves.toBe(false);
  });

  it("rejects a signature for a different payload", async () => {
    const signature = signPayload(TEST_PAYLOAD, TEST_SECRET);
    await expect(verifyLinearWebhookSignature(`${TEST_PAYLOAD} `, TEST_SECRET, signature)).resolves.toBe(false);
  });
});
