import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const base = process.argv[2] || "http://127.0.0.1:4176/";
  await page.goto(new URL("#/read/000789", base).href);
  await page.locator('[data-testid="reader-page"] svg').waitFor();
  const measure = (action) =>
    page.evaluate(async (action) => {
      const selector = '[data-testid="reader-page"]';
      const old = document.querySelector(selector)?.getAttribute("data-start");
      const oldDirection = document
        .querySelector(`${selector} svg`)
        ?.getAttribute("data-stone-direction");
      const start = performance.now();
      if (action === "open") location.hash = "#/read/000789";
      else
        document
          .querySelector(
            `[aria-label="${action === "next" ? "次のページ" : oldDirection === "tbRl" ? "横書きに切り替え" : "縦書きに切り替え"}"]`,
          )
          .click();
      await new Promise((resolve, reject) => {
        const poll = () => {
          const root = document.querySelector(selector);
          const svg = root?.querySelector("svg");
          const ready =
            svg &&
            !document.querySelector(".reader-loading") &&
            (action === "open" ||
              (action === "next" && root.getAttribute("data-start") !== old) ||
              (action === "direction" &&
                svg.getAttribute("data-stone-direction") !== oldDirection));
          if (ready)
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          else if (performance.now() - start > 10000)
            reject(new Error(`Timed out: ${action}`));
          else requestAnimationFrame(poll);
        };
        poll();
      });
      return Math.round(performance.now() - start);
    }, action);
  const open = [];
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      location.hash = "#/";
    });
    await page.locator(".book-card").first().waitFor();
    open.push(await measure("open"));
  }
  const next = [];
  for (let i = 0; i < 20; i++) next.push(await measure("next"));
  const direction = [];
  for (let i = 0; i < 6; i++) direction.push(await measure("direction"));
  const summary = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return {
      count: values.length,
      median:
        sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      max: sorted.at(-1),
      raw: values,
    };
  };
  const result = {
    browser: browser.version(),
    viewport: "1440x900",
    book: "吾輩は猫である",
    source:
      "production build, localhost, cached book, native click to two animation frames after ready DOM",
    open: summary(open),
    next: summary(next),
    direction: summary(direction),
  };
  await mkdir(".cache", { recursive: true });
  await writeFile(".cache/performance.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
