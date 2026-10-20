/**
 * Shared Delphic auth gate.
 * Login lives at auth.delphic.studio. This app only stores the Firebase ID token
 * and sends it to its own API.
 */

const AUTH_ORIGIN = "https://auth.delphic.studio";
const TOKEN_KEY = "delphic_token";

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

export function urlWithoutTokenFragment(href: string): string {
  const url = new URL(href);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : "";
  if (!hash) return url.toString();

  const params = new URLSearchParams(hash);
  if (!params.has("token")) return url.toString();

  params.delete("token");
  const rest = params.toString();
  url.hash = rest ? `#${rest}` : "";
  return url.toString();
}

export function delphicAuthRedirectUrl(currentHref: string): string {
  return `${AUTH_ORIGIN}/?redirect=${encodeURIComponent(urlWithoutTokenFragment(currentHref))}`;
}

export function establishDelphicSession(): boolean {
  const token = readDelphicToken();
  if (isDelphicTokenValid(token)) return true;
  redirectToDelphicAuth();
  return false;
}

export function delphicAuthorizationHeader(): string | null {
  const token = readDelphicToken();
  if (!isDelphicTokenValid(token)) return null;
  return `Bearer ${token}`;
}

export function redirectToDelphicAuth(): void {
  if (window.location.origin === AUTH_ORIGIN) return;
  clearDelphicToken();
  window.location.replace(delphicAuthRedirectUrl(window.location.href));
}

export function isOwnApiRequest(url: string | undefined, baseURL: string | undefined, serviceBaseURL: string): boolean {
  const requestUrl = url ?? "";
  if (/^https?:\/\//i.test(requestUrl)) {
    try {
      const target = new URL(requestUrl);
      const base = resolveBase(baseURL || serviceBaseURL);
      return !!base && target.origin === base.origin;
    } catch {
      return false;
    }
  }

  return Boolean(serviceBaseURL || baseURL);
}

function readDelphicToken(): string | null {
  captureFragmentToken();
  const fromSession = sessionStorage.getItem(TOKEN_KEY);
  if (fromSession) return fromSession;
  return readCookie(TOKEN_KEY);
}

function captureFragmentToken(): void {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  if (!hash) return;

  const params = new URLSearchParams(hash);
  const token = params.get("token");
  if (!token) return;

  sessionStorage.setItem(TOKEN_KEY, token);
  params.delete("token");
  const rest = params.toString();
  const url = new URL(window.location.href);
  url.hash = rest ? `#${rest}` : "";
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function clearDelphicToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  document.cookie = `${TOKEN_KEY}=; Max-Age=0; Path=/`;
  document.cookie = `${TOKEN_KEY}=; Max-Age=0; Path=/; Domain=.delphic.studio; Secure; SameSite=Lax`;
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const raw = trimmed.slice(prefix.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function resolveBase(base: string | undefined): URL | null {
  if (!base) return null;
  try {
    return new URL(base, window.location.origin);
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}
