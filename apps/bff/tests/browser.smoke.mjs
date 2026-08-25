import { launch } from "puppeteer-core";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
const WORKSPACE = process.env.PLANE_WORKSPACE_SLUG ?? "delphic";
const CHROME_PATH = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const browser = await launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  const failed = [];

  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("localhost:8000")) return;
    if (response.status() >= 400) {
      failed.push(`${response.status()} ${url}`);
    }
  });

  console.log(`[browser] open ${WEB_URL}/${WORKSPACE}/`);
  await page.goto(`${WEB_URL}/${WORKSPACE}/`, { waitUntil: "networkidle0", timeout: 60_000 });

  const title = await page.title();
  if (title.toLowerCase().includes("error")) {
    throw new Error(`Page title indicates error: ${title}`);
  }

  const projectHref = await page.$eval('a[href*="/projects/"]', (el) => el.getAttribute("href"));
  if (!projectHref) throw new Error("No project link found in sidebar");
  console.log(`[browser] click project link ${projectHref}`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30_000 }),
    page.click(`a[href="${projectHref}"]`),
  ]);

  const issueHref = await page.$eval('a[href*="/issues/"]', (el) => el.getAttribute("href"));
  if (!issueHref) throw new Error("No issue link found on project page");
  console.log(`[browser] click issue link ${issueHref}`);
  await page.click(`a[href="${issueHref}"]`);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  if (failed.length > 0) {
    console.error("[browser] failed API responses:");
    for (const item of failed) console.error(`  ${item}`);
    throw new Error(`Detected ${failed.length} failed BFF API responses during navigation`);
  }

  console.log("[browser] smoke test passed");
  await browser.close();
}

main().catch((error) => {
  console.error("[browser] smoke test failed:", error);
  process.exit(1);
});
