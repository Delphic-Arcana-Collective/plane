/**
 * Parallel cold-boot check: two browsers load project B for up to 30s.
 * BOTH must reach headerCount > 0 and issueBlocks > 0.
 */
/* eslint-disable no-await-in-loop -- polling loops are intentional */

import { launch } from "puppeteer-core";

const WEB_URL = (process.env.WEB_URL ?? "https://dashboard.delphic.studio").replace(/\/$/, "");
const PROJECT_B = process.env.PROJECT_B_ID ?? "linear-team:c69b6a31-7997-4ecf-93e4-462fa2217f61";
const WORKSPACE_SLUG = process.env.WORKSPACE_SLUG ?? "delphic";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 30_000);
const CHROME_PATH =
  process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

const TARGET = `${WEB_URL}/${WORKSPACE_SLUG}/projects/${encodeURIComponent(PROJECT_B)}/issues/`;

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function readState(page) {
  return page.evaluate(() => {
    const loading = !!document.querySelector(
      '[class*="layout-loader"], [class*="ListLayoutLoader"], [class*="animate-pulse"]'
    );
    const headerMatch = document.body.innerText.match(/Work Items\n(\d+)/);
    const headerCount = headerMatch ? Number(headerMatch[1]) : 0;
    const issueBlocks = document.querySelectorAll('[id^="issue-"]').length;
    const issueUnderscore = document.querySelectorAll('[id^="issue_"]').length;
    return { loading, headerCount, issueBlocks, issueUnderscore, url: location.href };
  });
}

async function coldBoot(browser, workerId) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const started = Date.now();
  const samples = [];

  try {
    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.evaluate(() => {
      try {
        sessionStorage.clear();
        localStorage.clear();
      } catch {
        /* ignore */
      }
    });
    // Hard reload after clearing storage so each worker is a true cold boot.
    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 120_000 });

    let readyAt = null;
    while (Date.now() - started < TIMEOUT_MS) {
      const state = await readState(page);
      samples.push({ t: Date.now() - started, ...state });

      const forbidden = !state.loading && state.headerCount > 0 && state.issueBlocks === 0;
      if (forbidden) {
        console.warn(`[w${workerId}] FORBIDDEN empty-ready at ${Date.now() - started}ms:`, JSON.stringify(state));
      }

      if (state.headerCount > 0 && state.issueBlocks > 0) {
        readyAt = Date.now() - started;
        // Require stability across a few polls
        let stable = 1;
        for (let i = 0; i < 2; i++) {
          await sleep(150);
          const again = await readState(page);
          samples.push({ t: Date.now() - started, ...again });
          if (again.headerCount > 0 && again.issueBlocks > 0) stable++;
          else break;
        }
        if (stable >= 3) {
          console.log(`[w${workerId}] READY in ${readyAt}ms`, JSON.stringify(state));
          return { workerId, ok: true, readyAt, samples, final: state };
        }
      }
      await sleep(200);
    }

    const final = samples[samples.length - 1] ?? (await readState(page));
    console.error(`[w${workerId}] FAIL after ${TIMEOUT_MS}ms`, JSON.stringify(final));
    return { workerId, ok: false, readyAt: null, samples, final };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main() {
  console.log(`[cold-boot] TARGET=${TARGET} timeout=${TIMEOUT_MS}ms parallel=2`);
  const browser = await launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const results = await Promise.all([coldBoot(browser, 1), coldBoot(browser, 2)]);
    const allOk = results.every((r) => r.ok);
    for (const r of results) {
      const forbiddenHits = r.samples.filter((s) => !s.loading && s.headerCount > 0 && s.issueBlocks === 0);
      console.log(
        `[cold-boot] w${r.workerId} ok=${r.ok} readyAt=${r.readyAt} forbiddenSamples=${forbiddenHits.length}`
      );
    }
    if (!allOk) {
      process.exitCode = 1;
      console.error("[cold-boot] FAIL — both browsers must reach header>0 and issueBlocks>0");
      return;
    }
    console.log("[cold-boot] PASS — both parallel browsers ready");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[cold-boot] fatal:", error);
  process.exit(1);
});
