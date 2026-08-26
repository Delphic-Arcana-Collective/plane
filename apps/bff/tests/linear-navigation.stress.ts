/**
 * Local navigation stress test: B → deselect → A → B, repeated.
 *
 * Prerequisites:
 *   - Web dev server on WEB_URL (default http://localhost:3000) with VITE_LINEAR_DISPLAY_MODE=true
 *
 * Usage:
 *   pnpm --filter=bff test:navigation-stress
 *   ROUNDS=1000 pnpm --filter=bff test:navigation-stress
 */

/* oxlint-disable no-await-in-loop */

import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { launch, type Browser, type Page } from "puppeteer-core";
import { MemoryCacheBackend } from "../src/cache/store.js";
import { createServer } from "../src/server.js";
import { createTestEnv, TEST_WORKSPACE_SLUG } from "./test-utils.js";
import {
  createNavigationStressSnapshot,
  NAV_ISSUE_A_MARKER,
  NAV_ISSUE_B_MARKER,
  NAV_PROJECT_A_ID,
  NAV_PROJECT_A_NAME,
  NAV_PROJECT_B_ID,
  NAV_PROJECT_B_NAME,
} from "./fixtures/navigation-stress-snapshot.js";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
const WEB_API_BASE = process.env.WEB_API_BASE ?? "http://localhost:8000";
const STRESS_BFF_PORT = Number(process.env.STRESS_BFF_PORT ?? 8799);
const ROUNDS = Number(process.env.ROUNDS ?? 1000);
const CHROME_PATH = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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
    const server = serve(
      {
        fetch: app.fetch,
        port: STRESS_BFF_PORT,
      },
      () => {
        console.log(`[stress-bff] listening on http://localhost:${STRESS_BFF_PORT}`);
        resolve({ server, port: STRESS_BFF_PORT });
      }
    );
  });
}

async function waitForWeb(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${WEB_URL}/${TEST_WORKSPACE_SLUG}/`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Web app not reachable at ${WEB_URL}. Start it with pnpm dev first.`);
}

function rewriteBffUrl(url: string, stressPort: number): string {
  const webApi = new URL(WEB_API_BASE);
  return url.replace(`${webApi.host}`, `localhost:${stressPort}`);
}

async function setupPage(browser: Browser, stressPort: number): Promise<Page> {
  const page = await browser.newPage();
  await page.setRequestInterception(true);

  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("localhost:8000") || url.includes(WEB_API_BASE.replace(/^https?:\/\//, ""))) {
      request.continue({ url: rewriteBffUrl(url, stressPort) });
      return;
    }
    request.continue();
  });

  return page;
}

async function clickProject(page: Page, projectName: string): Promise<void> {
  const clicked = await page.evaluate((name) => {
    const candidates = [...document.querySelectorAll("a, button")];
    const match = candidates.find((el) => el.textContent?.trim().includes(name));
    if (!match) return false;
    (match as HTMLElement).click();
    return true;
  }, projectName);

  if (!clicked) {
    throw new Error(`Sidebar project not found: ${projectName}`);
  }
}

type ViewState = {
  onProjectIssues: boolean;
  hasLoader: boolean;
  hasIssueMarker: boolean;
  hasLoadMore: boolean;
  url: string;
};

async function readProjectViewState(page: Page, expectedMarker?: string): Promise<ViewState> {
  return page.evaluate((marker) => {
    const url = window.location.href;
    const onProjectIssues = /\/projects\/[^/]+\/issues/.test(url);
    const hasLoader = document.querySelector('[aria-label="Loading"]') !== null;
    const bodyText = document.body?.innerText ?? "";
    const html = document.body?.innerHTML ?? "";
    const hasIssueBlocks =
      document.querySelectorAll('[id^="issue_issue-"]').length > 0 || html.includes("stress issue");
    const hasIssueMarker =
      hasIssueBlocks ||
      (marker
        ? bodyText.includes(marker) || bodyText.includes("stress issue") || html.includes(marker)
        : /\bNAV-[AB]-\d+\b/.test(bodyText) || bodyText.includes("stress issue") || html.includes("NAV-"));
    const hasLoadMore = /load more/i.test(bodyText);
    return { onProjectIssues, hasLoader, hasIssueMarker, hasLoadMore, url };
  }, expectedMarker ?? "");
}

/** Forbidden: on project issues route, not loading, no visible issues. */
function isForbiddenEmptyReady(state: ViewState): boolean {
  return state.onProjectIssues && !state.hasLoader && !state.hasIssueMarker;
}

async function assertHealthyProjectView(page: Page, expectedMarker: string, round: number, step: string) {
  const state = await readProjectViewState(page, expectedMarker);

  if (state.hasLoadMore) {
    throw new Error(`round ${round} ${step}: load-more UI visible`);
  }

  if (isForbiddenEmptyReady(state)) {
    throw new Error(`round ${round} ${step}: forbidden empty+ready at ${state.url}`);
  }

  if (state.onProjectIssues && !state.hasLoader && !state.hasIssueMarker) {
    throw new Error(`round ${round} ${step}: project issues view has no content at ${state.url}`);
  }
}

async function waitForProjectIssues(page: Page, projectId: string, marker: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.includes(`/projects/${encodeURIComponent(projectId)}/issues`)) {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      const state = await readProjectViewState(page, marker);
      if (state.hasIssueMarker && !state.hasLoader) return;
      if (state.hasLoader) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const finalState = await readProjectViewState(page, marker);
  const snippet = await page.evaluate(() => ({
    text: document.body.innerText.slice(0, 1200),
    htmlHasIssueId: document.body.innerHTML.includes("issue-NAV-B-1"),
    issueBlockCount: document.querySelectorAll('[id^="issue_issue-"]').length,
    groupedKeys: document.querySelector("[data-linear-grouped-keys]")?.getAttribute("data-linear-grouped-keys") ?? null,
    hocReady: document.querySelector("[data-linear-ready]")?.getAttribute("data-linear-ready") ?? null,
    bucketSizes: document.querySelector("[data-linear-bucket-sizes]")?.getAttribute("data-linear-bucket-sizes") ?? null,
    firstIssueId:
      document.querySelector("[data-linear-first-issue-id]")?.getAttribute("data-linear-first-issue-id") ?? null,
    firstCreated:
      document.querySelector("[data-linear-first-created]")?.getAttribute("data-linear-first-created") ?? null,
    listGroupId: document.querySelector("[data-list-group-id]")?.getAttribute("data-list-group-id") ?? null,
    listGroupIssueCount:
      document.querySelector("[data-list-group-issue-count]")?.getAttribute("data-list-group-issue-count") ?? null,
  }));
  if (isForbiddenEmptyReady(finalState)) {
    throw new Error(
      `Timed out on project ${projectId}: empty+ready at ${finalState.url}\n--- debug ---\n${JSON.stringify(snippet, null, 2)}`
    );
  }
  throw new Error(
    `Timed out waiting for marker ${marker} on project ${projectId} at ${finalState.url}\n--- page text ---\n${snippet}`
  );
}

async function waitForSidebarProjects(page: Page) {
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return text.includes("Nav Project Alpha") && text.includes("Nav Project Beta");
    },
    { timeout: 30_000 }
  );
}

async function runRound(page: Page, round: number) {
  await page.goto(`${WEB_URL}/${TEST_WORKSPACE_SLUG}/workspace-views/all-issues`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await waitForSidebarProjects(page);

  // B → deselect B → A → B
  await clickProject(page, NAV_PROJECT_B_NAME);
  await waitForProjectIssues(page, NAV_PROJECT_B_ID, NAV_ISSUE_B_MARKER);
  await assertHealthyProjectView(page, NAV_ISSUE_B_MARKER, round, "after B");

  await clickProject(page, NAV_PROJECT_B_NAME);
  await page.waitForFunction(() => /\/workspace-views\/all-issues/.test(window.location.href), {
    timeout: 10_000,
  });

  await clickProject(page, NAV_PROJECT_A_NAME);
  await waitForProjectIssues(page, NAV_PROJECT_A_ID, NAV_ISSUE_A_MARKER);
  await assertHealthyProjectView(page, NAV_ISSUE_A_MARKER, round, "after A");

  await clickProject(page, NAV_PROJECT_B_NAME);
  await waitForProjectIssues(page, NAV_PROJECT_B_ID, NAV_ISSUE_B_MARKER);
  await assertHealthyProjectView(page, NAV_ISSUE_B_MARKER, round, "after return to B");
}

async function main() {
  console.log(`[stress] starting BFF fixture on port ${STRESS_BFF_PORT}, ${ROUNDS} rounds`);
  const { server, port } = await startStressBff();

  try {
    await waitForWeb();
  } catch (error) {
    server.close();
    throw error;
  }

  const browser = await launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let failures = 0;
  const failedRounds: number[] = [];

  try {
    const page = await setupPage(browser, port);
    await page.setViewport({ width: 1440, height: 900 });

    for (let round = 1; round <= ROUNDS; round++) {
      try {
        await runRound(page, round);
        if (round % 100 === 0 || round === 1) {
          console.log(`[stress] round ${round}/${ROUNDS} ok`);
        }
      } catch (error) {
        failures++;
        failedRounds.push(round);
        console.error(`[stress] round ${round} FAILED:`, error instanceof Error ? error.message : error);
        if (failures >= 5) {
          console.error("[stress] aborting after 5 failures");
          break;
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures > 0) {
    console.error(`[stress] ${ROUNDS - failures}/${ROUNDS} passed; failed rounds: ${failedRounds.join(", ")}`);
    process.exit(1);
  }

  console.log(`[stress] ${ROUNDS}/${ROUNDS} passed`);
}

main().catch((error) => {
  console.error("[stress] fatal:", error);
  process.exit(1);
});
