/**
 * Local navigation stress test: A → B → B, repeated (project-only, no merged all-issues view).
 * Single browser session; rounds chain client-side (no per-round goto).
 */

/* oxlint-disable no-await-in-loop */

import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { launch, type Browser, type HTTPRequest, type HTTPResponse, type Page } from "puppeteer-core";
import { MemoryCacheBackend } from "../src/cache/store.js";
import { createServer } from "../src/server.js";
import { createTestEnv, TEST_WORKSPACE_SLUG } from "./test-utils.js";
import {
  createNavigationStressSnapshot,
  NAV_PROJECT_A_ID,
  NAV_PROJECT_A_NAME,
  NAV_PROJECT_B_ID,
  NAV_PROJECT_B_NAME,
} from "./fixtures/navigation-stress-snapshot.js";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
const STRESS_BFF_PORT = Number(process.env.STRESS_BFF_PORT ?? 8799);
const ROUNDS = Number(process.env.ROUNDS ?? 100);
const CLICK_DELAY_MS = Number(process.env.CLICK_DELAY_MS ?? 0);
const CHROME_PATH =
  process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

type StressTimeouts = {
  projectMs: number;
  sidebarMs: number;
  gotoMs: number;
  pathWaitCapMs: number;
};

type CachedResponse = {
  status: number;
  contentType: string;
  body: string;
};

const BOOT_TIMEOUTS: StressTimeouts = {
  projectMs: 90_000,
  sidebarMs: 45_000,
  gotoMs: 120_000,
  pathWaitCapMs: 8_000,
};

async function startStressBff(): Promise<{ server: ServerType; port: number }> {
  const env = createTestEnv({
    BFF_PORT: STRESS_BFF_PORT,
    CACHE_INITIAL_FETCH: false,
    SYNC_ON_CACHE_MISS: false,
  });
  const cache = new MemoryCacheBackend();
  await cache.reset();
  await cache.applySnapshot(createNavigationStressSnapshot(), env);
  const app = createServer(env, cache);

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: STRESS_BFF_PORT }, () => {
      console.log(`[stress-bff] listening on http://localhost:${STRESS_BFF_PORT}`);
      resolve({ server, port: STRESS_BFF_PORT });
    });
  });
}

async function waitForWeb(): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${WEB_URL}/${TEST_WORKSPACE_SLUG}/`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Web app not reachable at ${WEB_URL}`);
}

function shouldRewriteToStressBff(url: string): boolean {
  return /https?:\/\/(localhost|127\.0\.0\.1):8000\b/.test(url);
}

function rewriteBffUrl(url: string, stressPort: number): string {
  return url.replace(/\/\/(localhost|127\.0\.0\.1):8000\b/g, `//$1:${stressPort}`);
}

function isHealthCheck(url: string): boolean {
  return /\/health(?:\?|$)/.test(url);
}

function isNoisyStub(url: string, stressPort: number): CachedResponse | null {
  if (isHealthCheck(url)) {
    return { status: 200, contentType: "application/json", body: '{"status":"ok"}' };
  }
  const host = new RegExp(`^https?://(localhost|127\\.0\\.0\\.1):${stressPort}`);
  if (!host.test(url)) return null;
  if (/\/estimates\/?(\?|$)/.test(url) || /\/views\/?(\?|$)/.test(url)) {
    return { status: 200, contentType: "application/json", body: "[]" };
  }
  return null;
}

function isCacheableStressBffGet(url: string, stressPort: number): boolean {
  return new RegExp(`^https?://(localhost|127\\.0\\.0\\.1):${stressPort}/api/`).test(url);
}

async function setupPage(browser: Browser, stressPort: number): Promise<Page> {
  const page = await browser.newPage();
  const responseCache = new Map<string, CachedResponse>();

  await page.setRequestInterception(true);
  page.on("request", (request) => {
    void handleRequest(request, stressPort, responseCache);
  });
  page.on("response", (response) => {
    void cacheResponse(response, stressPort, responseCache);
  });
  return page;
}

async function handleRequest(request: HTTPRequest, stressPort: number, responseCache: Map<string, CachedResponse>) {
  let url = request.url();
  if (shouldRewriteToStressBff(url)) {
    url = rewriteBffUrl(url, stressPort);
  }

  const stub = isNoisyStub(url, stressPort);
  if (stub) {
    await request.respond(stub);
    return;
  }

  if (request.method() === "GET" && isCacheableStressBffGet(url, stressPort)) {
    const cached = responseCache.get(url);
    if (cached) {
      await request.respond({
        status: cached.status,
        contentType: cached.contentType,
        body: cached.body,
      });
      return;
    }
  }

  if (url !== request.url()) {
    await request.continue({ url });
    return;
  }
  await request.continue();
}

async function cacheResponse(response: HTTPResponse, stressPort: number, responseCache: Map<string, CachedResponse>) {
  const request = response.request();
  if (request.method() !== "GET") return;
  if (response.status() < 200 || response.status() >= 300) return;

  const url = response.url();
  if (isNoisyStub(url, stressPort) || !isCacheableStressBffGet(url, stressPort)) return;

  try {
    const body = await response.text();
    responseCache.set(url, {
      status: response.status(),
      contentType: response.headers()["content-type"] ?? "application/json",
      body,
    });
  } catch {
    // ignore cache write failures
  }
}

async function bootToProjectB(page: Page, timeouts: StressTimeouts, stepPrefix: string) {
  await page.goto(`${WEB_URL}/${TEST_WORKSPACE_SLUG}/projects/${encodeURIComponent(NAV_PROJECT_B_ID)}/issues`, {
    waitUntil: "domcontentloaded",
    timeout: timeouts.gotoMs,
  });
  await waitForProjectReady(page, timeouts.projectMs, `${stepPrefix} select B`);
}

async function restoreRoundState(page: Page, timeouts: StressTimeouts, useGoto = false) {
  if (useGoto) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: BOOT_TIMEOUTS.gotoMs });
    await bootToProjectB(page, BOOT_TIMEOUTS, "restore");
    return;
  }

  const onProjectB = await page.evaluate(
    (fragment) => window.location.pathname.includes(fragment),
    `/projects/${encodeURIComponent(NAV_PROJECT_B_ID)}/issues`
  );
  if (onProjectB) return;

  await bootToProjectB(page, timeouts, "restore");
}

function projectClickSelector(projectId: string): string {
  return `#${projectId.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1")} a`;
}

async function clickProject(page: Page, projectId: string, projectName: string, timeoutMs: number): Promise<void> {
  const selector = projectClickSelector(projectId);
  try {
    await page.waitForSelector(selector, { visible: true, timeout: timeoutMs });
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      el?.scrollIntoView({ block: "center", inline: "nearest" });
    }, selector);
    await page.click(selector, { delay: 0 });
    return;
  } catch {
    // fall through to text-based click
  }

  const clicked = await page.evaluate((name) => {
    const sidebarRoots = document.querySelectorAll('[id^="sidebar-"], #sidebar-projects');
    const candidates = document.querySelectorAll("a, button");
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i] as HTMLElement;
      let inSidebar = false;
      for (let j = 0; j < sidebarRoots.length; j++) {
        if (sidebarRoots[j].contains(el)) {
          inSidebar = true;
          break;
        }
      }
      if (inSidebar && (el.textContent || "").indexOf(name) >= 0) {
        el.scrollIntoView({ block: "center", inline: "nearest" });
        el.click();
        return true;
      }
    }
    return false;
  }, projectName);
  if (!clicked) throw new Error(`Sidebar project not found: ${projectName} (${projectId})`);
}

async function clickUntilPath(
  page: Page,
  projectId: string,
  projectName: string,
  pathFragment: string,
  timeoutMs: number,
  pathWaitCapMs: number,
  step: string
) {
  const already = await page.evaluate((fragment) => window.location.pathname.includes(fragment), pathFragment);
  if (already) return;

  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await clickProject(page, projectId, projectName, Math.min(remaining, 1500));
    if (CLICK_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, CLICK_DELAY_MS));
    }
    try {
      await page.waitForFunction(
        (fragment) => window.location.pathname.includes(fragment),
        { timeout: Math.min(remaining, pathWaitCapMs), polling: 16 },
        pathFragment
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `${step}: path ${pathFragment} not reached (${lastError instanceof Error ? lastError.message : lastError})`
  );
}

async function waitForIssueBlocks(page: Page, timeoutMs: number, step: string) {
  const readyNow = await page.evaluate(() => document.querySelectorAll('[id^="issue_issue-"]').length > 0);
  if (readyNow) return;

  try {
    await page.waitForFunction(() => document.querySelectorAll('[id^="issue_issue-"]').length > 0, {
      timeout: timeoutMs,
      polling: 16,
    });
  } catch (error) {
    throw new Error(`${step}: ${error instanceof Error ? error.message : error}`, { cause: error });
  }
}

async function waitForProjectReady(page: Page, timeoutMs: number, step: string) {
  await waitForIssueBlocks(page, timeoutMs, step);
}

/** A → B. Caller must leave the page on project B. */
async function runRoundSteps(page: Page, timeouts: StressTimeouts) {
  await clickUntilPath(
    page,
    NAV_PROJECT_A_ID,
    NAV_PROJECT_A_NAME,
    `/projects/${encodeURIComponent(NAV_PROJECT_A_ID)}/issues`,
    timeouts.sidebarMs,
    timeouts.pathWaitCapMs,
    "select A"
  );
  await waitForIssueBlocks(page, timeouts.projectMs, "select A");

  await clickUntilPath(
    page,
    NAV_PROJECT_B_ID,
    NAV_PROJECT_B_NAME,
    `/projects/${encodeURIComponent(NAV_PROJECT_B_ID)}/issues`,
    timeouts.sidebarMs,
    timeouts.pathWaitCapMs,
    "select B again"
  );
  await waitForIssueBlocks(page, timeouts.projectMs, "select B again");
}

async function calibrateTimeouts(page: Page): Promise<StressTimeouts> {
  const start = Date.now();
  await runRoundSteps(page, BOOT_TIMEOUTS);
  const roundMs = Date.now() - start;
  const timeouts = {
    projectMs: Math.max(3_000, Math.ceil(roundMs * 0.35)),
    sidebarMs: Math.max(12_000, Math.ceil(roundMs * 0.8)),
    gotoMs: Math.max(15_000, Math.ceil(roundMs * 0.5)),
    pathWaitCapMs: Math.max(3_000, Math.ceil(roundMs * 0.5)),
  };
  console.log(`[stress] calibrated ${roundMs}ms/round`, timeouts);
  return timeouts;
}

async function main() {
  const runStart = Date.now();
  console.log(`[stress] ${ROUNDS} rounds, click delay ${CLICK_DELAY_MS}ms, single browser session`);
  const { server, port } = await startStressBff();
  await waitForWeb();

  const browser = await launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  let successes = 0;
  let failures = 0;
  const failedRounds: number[] = [];

  try {
    const page = await setupPage(browser, port);
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${WEB_URL}/${TEST_WORKSPACE_SLUG}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.evaluate(() => sessionStorage.clear());

    await bootToProjectB(page, BOOT_TIMEOUTS, "initial");
    const timeouts = await calibrateTimeouts(page);

    for (let round = 1; round <= ROUNDS; round++) {
      try {
        await runRoundSteps(page, timeouts);
        successes++;
        if (round % 100 === 0 || round === ROUNDS) {
          const elapsedSec = ((Date.now() - runStart) / 1000).toFixed(1);
          console.log(`[stress] ${round}/${ROUNDS} ok (${elapsedSec}s elapsed)`);
        }
      } catch (error) {
        failures++;
        failedRounds.push(round);
        console.error(`[stress] ${round}/${ROUNDS} FAILED:`, error instanceof Error ? error.message : error);
        try {
          await restoreRoundState(page, timeouts, true);
        } catch (restoreError) {
          console.error(
            `[stress] ${round}/${ROUNDS} restore failed:`,
            restoreError instanceof Error ? restoreError.message : restoreError
          );
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  const wallSec = (Date.now() - runStart) / 1000;
  const roundsPerSec = successes > 0 ? (successes / wallSec).toFixed(2) : "0";

  if (failures > 0) {
    console.error(
      `[stress] done: ${successes}/${ROUNDS} passed in ${wallSec.toFixed(1)}s (${roundsPerSec} r/s); failed: ${failedRounds.join(", ")}`
    );
    process.exit(1);
  }

  console.log(`[stress] ${ROUNDS}/${ROUNDS} passed in ${wallSec.toFixed(1)}s (${roundsPerSec} r/s)`);
}

main().catch((error) => {
  console.error("[stress] fatal:", error);
  process.exit(1);
});
