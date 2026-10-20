/** Structural Firebase ID token check: three JWT segments and an unexpired exp (seconds). */
export function isDelphicTokenValid(token: string | null | undefined, nowMs = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return false;

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) && payload.exp > nowMs / 1000;
  } catch {
    return false;
  }
}

export function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

/**
 * Routes that are not the product API session.
 * Sign-out is a browser form post and cannot attach Authorization.
 * Sync uses its own shared secret.
 */
export function isPublicDelphicRequest(method: string, path: string): boolean {
  if (method === "OPTIONS") return true;
  if (path === "/health" || path === "/health/") return true;
  if (path === "/internal/sync-linear" || path === "/internal/sync-linear/") return true;
  if (method === "POST" && (path === "/auth/sign-out" || path === "/auth/sign-out/")) return true;
  if (path === "/webhooks/linear" || path === "/webhooks/linear/") return true;
  return false;
}

function decodeBase64Url(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}
