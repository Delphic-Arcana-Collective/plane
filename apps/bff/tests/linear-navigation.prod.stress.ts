/**
 * Production navigation stress test against a deployed Linear dashboard.
 * Sidebar clicks: A → B → A with slow delay between clicks.
 */

/* oxlint-disable no-await-in-loop */

import { launch, type Browser, type Page } from "puppeteer-core";

const WEB_URL = (process.env.WEB_URL ?? "https://dashboard.delphic.studio").replace(/\/$/, "");
const WORKSPACE_SLUG = process.env.WORKSPACE_SLUG ?? "delphic";
const PARALLEL = Number(process.env.PARALLEL ?? 5);
const ROUNDS = Number(process.env.ROUNDS ?? 20);
const CLICK_DELAY_MS = Number(process.env.CLICK_DELAY_MS ?? 400);
const CHROME_PATH =
  process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

type ProjectRef = { id: string; name: string };

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverProjects(page: Page): Promise<[ProjectRef, ProjectRef]> {
  await page.goto(`${WEB_URL}/${WORKSPACE_SLUG}/`, {
    waitUntil: "networkidle2",
    timeout: 120_000,
  });
  await page.evaluate(() => sessionStorage.clear());
  await sleep(2000);

  await page.waitForFunction(() => document.querySelectorAll('a[href*="/projects/"][href*="/issues"]').length >= 2, {
    timeout: 90_000,
    polling: 250,
  });

  const projects = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll('a[href*="/projects/"][href*="/issues"]')
    ) as HTMLAnchorElement[];
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];

    for (const link of links) {
      const match = link.pathname.match(/\/projects\/([^/]+)\/issues\/?$/);
      if (!match) continue;
      const id = decodeURIComponent(match[1]);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: (link.textContent || id).trim() });
      if (out.length >= 2) break;
    }

    return out;
  });

  if (projects.length < 2) {
    throw new Error(`Need at least 2 sidebar projects, found ${projects.length}`);
  }

  return [projects[0], projects[1]];
}

async function clickProject(page: Page, project: ProjectRef) {
  const clicked = await page.evaluate(
    ({ projectId, name }) => {
      const links = Array.from(
        document.querySelectorAll('a[href*="/projects/"][href*="/issues"]')
      ) as HTMLAnchorElement[];
      for (const link of links) {
        if (decodeURIComponent(link.pathname).includes(projectId)) {
          link.scrollIntoView({ block: "center", inline: "nearest" });
          link.click();
          return true;
        }
      }
      for (const link of links) {
        if ((link.textContent || "").trim() === name) {
          link.scrollIntoView({ block: "center", inline: "nearest" });
          link.click();
          return true;
        }
      }
      return false;
    },
    { projectId: project.id, name: project.name }
  );

  if (!clicked) throw new Error(`Could not click project ${project.name}`);
  if (CLICK_DELAY_MS > 0) await sleep(CLICK_DELAY_MS);
}

async function waitForProjectReady(page: Page, projectId: string, timeoutMs: number) {
  await page.waitForFunction(
    (id) => decodeURIComponent(window.location.pathname).includes(id),
    { timeout: timeoutMs, polling: 16 },
    projectId
  );

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const loading = !!document.querySelector('[class*="layout-loader"], [class*="ListLayoutLoader"]');
      const headerMatch = document.body.innerText.match(/Work Items\n(\d+)/);
      const headerCount = headerMatch ? Number(headerMatch[1]) : 0;
      const issueBlocks = document.querySelectorAll('[id^="issue-"]').length;
      return { loading, headerCount, issueBlocks };
    });

    if (state.loading) {
      await sleep(150);
      continue;
    }

    if (state.headerCount === 0 && state.issueBlocks === 0) {
      await sleep(150);
      continue;
    }

    if (state.headerCount > 0 && state.issueBlocks === 0) {
      await sleep(150);
      continue;
    }

    return state;
  }

  throw new Error(`Project ${projectId} did not become ready in ${timeoutMs}ms`);
}

async function assertProjectView(page: Page, label: string) {
  const state = await page.evaluate(() => {
    const headerMatch = document.body.innerText.match(/Work Items\n(\d+)/);
    const headerCount = headerMatch ? Number(headerMatch[1]) : 0;
    const issueBlocks = document.querySelectorAll('[id^="issue-"]').length;
    return { headerCount, issueBlocks };
  });

  if (state.headerCount > 0 && state.issueBlocks === 0) {
    throw new Error(`${label}: header=${state.headerCount} but list rendered 0 issue rows`);
  }
}

async function runRound(page: Page, projectA: ProjectRef, projectB: ProjectRef, round: number, workerId: number) {
  await clickProject(page, projectA);
  await waitForProjectReady(page, projectA.id, 90_000);
  await assertProjectView(page, `w${workerId} r${round} project A`);

  await clickProject(page, projectB);
  await waitForProjectReady(page, projectB.id, 90_000);
  await assertProjectView(page, `w${workerId} r${round} project B`);

  await clickProject(page, projectA);
  await waitForProjectReady(page, projectA.id, 90_000);
  await assertProjectView(page, `w${workerId} r${round} back to A`);
}

async function bootProject(page: Page, project: ProjectRef) {
  await page.goto(`${WEB_URL}/${WORKSPACE_SLUG}/projects/${encodeURIComponent(project.id)}/issues`, {
    waitUntil: "networkidle2",
    timeout: 120_000,
  });
  await waitForProjectReady(page, project.id, 90_000);
}

async function worker(browser: Browser, workerId: number, projectA: ProjectRef, projectB: ProjectRef) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await bootProject(page, projectB);

  let passed = 0;
  const failures: string[] = [];

  try {
    for (let round = 1; round <= ROUNDS; round++) {
      try {
        await runRound(page, projectA, projectB, round, workerId);
        passed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`round ${round}: ${message}`);
        await bootProject(page, projectB).catch(() => undefined);
      }
    }
  } finally {
    await page.close();
  }

  return { workerId, passed, failures };
}

async function main() {
  console.log(
    `[prod-stress] ${WEB_URL}/${WORKSPACE_SLUG} parallel=${PARALLEL} rounds=${ROUNDS} delay=${CLICK_DELAY_MS}ms`
  );

  const browser = await launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const probe = await browser.newPage();
    const [projectA, projectB] = await discoverProjects(probe);
    await probe.close();
    console.log(`[prod-stress] projects: A="${projectA.name}" B="${projectB.name}"`);

    const results = await Promise.all(
      Array.from({ length: PARALLEL }, (_, index) => worker(browser, index + 1, projectA, projectB))
    );

    const totalPassed = results.reduce((sum, result) => sum + result.passed, 0);
    const totalAttempts = PARALLEL * ROUNDS;
    const allFailures = results.flatMap((result) => result.failures.map((f) => `w${result.workerId} ${f}`));

    if (allFailures.length > 0) {
      console.error(`[prod-stress] FAIL ${totalPassed}/${totalAttempts} passed`);
      for (const failure of allFailures.slice(0, 20)) {
        console.error(`  - ${failure}`);
      }
      if (allFailures.length > 20) console.error(`  ... and ${allFailures.length - 20} more`);
      process.exit(1);
    }

    console.log(`[prod-stress] PASS ${totalPassed}/${totalAttempts} (${PARALLEL} workers)`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[prod-stress] fatal:", error);
  process.exit(1);
});
