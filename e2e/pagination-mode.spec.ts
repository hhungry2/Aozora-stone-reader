import { expect, test, type Page } from "@playwright/test";
import { defaultSettings } from "../src/types";

const reader = (page: Page) => page.getByTestId("reader-page");
const preparation = (page: Page) => page.getByTestId("pagination-preload");
async function ready(page: Page) {
  await expect(reader(page).locator("svg").first()).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
}
async function chooseMode(page: Page, mode: "on-demand" | "batch" | "all") {
  await page
    .getByRole("button", { name: "読書設定を開く", exact: true })
    .click();
  await page.getByLabel("ページの準備", { exact: true }).selectOption(mode);
  await page
    .getByRole("button", { name: "読書設定を閉じる", exact: true })
    .click();
  await ready(page);
}
async function completed(page: Page) {
  await expect(preparation(page)).toHaveAttribute("data-state", "complete", {
    timeout: 40000,
  });
}

test("ten-page preparation replenishes and preserves bookmarks, navigation and saved settings", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/read/000456");
  await ready(page);
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await ready(page);
  const start = await reader(page).getAttribute("data-start");
  const block = await reader(page).getAttribute("data-block");
  const offset = await reader(page).getAttribute("data-offset");
  await page
    .getByRole("button", { name: "このページにしおりを挟む", exact: true })
    .click();
  await chooseMode(page, "batch");
  await completed(page);
  await expect(preparation(page)).toHaveAttribute("data-pages", "10");
  await expect(reader(page)).toHaveAttribute("data-start", start!);

  let previous = start;
  for (let turn = 0; turn < 12; turn++) {
    previous = await reader(page).getAttribute("data-start");
    const end = await reader(page).getAttribute("data-end");
    await page.getByRole("button", { name: "次のページ", exact: true }).click();
    await expect(reader(page)).toHaveAttribute("data-start", end!);
    await ready(page);
  }
  await page.getByRole("button", { name: "前のページ", exact: true }).click();
  await expect(reader(page)).toHaveAttribute("data-start", previous!);
  await ready(page);
  await completed(page);
  await expect(preparation(page)).toHaveText("10ページ先読み済み");
  await page
    .getByRole("button", { name: "しおり一覧を開く", exact: true })
    .click();
  await expect(page.locator(".bookmark-item")).toHaveCount(1);
  await page.locator(".bookmark-jump").click();
  await ready(page);
  await expect(reader(page)).toHaveAttribute("data-block", block!);
  await expect(reader(page)).toHaveAttribute("data-offset", offset!);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("aozora-stone-reader:v1:record:000456")!,
          ).anchor.offset,
      ),
    )
    .toBe(Number(offset));
  await page.reload();
  await ready(page);
  await expect(reader(page)).toHaveAttribute("data-block", block!);
  await expect(reader(page)).toHaveAttribute("data-offset", offset!);
  await completed(page);
  await expect(preparation(page)).toHaveAttribute("data-pages", "10");
  await page
    .getByRole("button", { name: "読書設定を開く", exact: true })
    .click();
  await expect(page.getByLabel("ページの準備", { exact: true })).toHaveValue(
    "batch",
  );
  await page
    .getByLabel("ページの準備", { exact: true })
    .selectOption("on-demand");
  await page
    .getByRole("button", { name: "読書設定を閉じる", exact: true })
    .click();
  await ready(page);
  await expect(preparation(page)).toHaveCount(0);
  await expect(reader(page)).toHaveAttribute("data-block", block!);
  await expect(reader(page)).toHaveAttribute("data-offset", offset!);
  expect(errors).toEqual([]);
});

test("full-book preparation allows reading and TOC jumps, reflows and only renders visible pages", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (settings) => {
      localStorage.setItem(
        "aozora-stone-reader:v1:settings",
        JSON.stringify({ ...settings, settingsVersion: 2 }),
      );
    },
    { ...defaultSettings, paginationMode: "all" },
  );
  await page.goto("/#/read/000456");
  await ready(page);
  await expect(preparation(page)).toBeVisible();
  const end = await reader(page).getAttribute("data-end");
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect(reader(page)).toHaveAttribute("data-start", end!);
  await ready(page);
  await page.getByRole("button", { name: "目次を開く", exact: true }).click();
  await page.locator(".toc-list > button").nth(2).click();
  await ready(page);
  const start = await reader(page).getAttribute("data-start");
  const block = await reader(page).getAttribute("data-block");
  const offset = await reader(page).getAttribute("data-offset");
  await completed(page);
  expect(
    Number(await preparation(page).getAttribute("data-pages")),
  ).toBeGreaterThan(10);
  await expect(preparation(page)).toHaveText(/全\d+ページ 組版済み/u);
  await expect(reader(page)).toHaveAttribute("data-start", start!);
  await expect(reader(page).locator("svg")).toHaveCount(1);
  await expect(page.locator(".reader-accessible-text")).toHaveCount(1);

  await page
    .getByRole("button", { name: "フォントサイズを調整", exact: true })
    .click();
  await page.getByLabel("フォントサイズ", { exact: true }).fill("24");
  await page.getByRole("button", { name: "調整を閉じる", exact: true }).click();
  await page
    .getByRole("button", { name: "読書設定を開く", exact: true })
    .click();
  await page.getByLabel("文字方向", { exact: true }).selectOption("lrTb");
  await page
    .getByRole("combobox", { name: "ページ表示", exact: true })
    .selectOption("spread");
  await page
    .getByRole("button", { name: "読書設定を閉じる", exact: true })
    .click();
  await ready(page);
  await completed(page);
  await expect(reader(page)).toHaveAttribute("data-block", block!);
  await expect(reader(page)).toHaveAttribute("data-offset", offset!);
  const visiblePages = await page.evaluate(() =>
    matchMedia("(min-width: 800px) and (orientation: landscape)").matches
      ? 2
      : 1,
  );
  await expect(reader(page).locator("svg")).toHaveCount(visiblePages);
  await expect(reader(page).locator("svg").first()).toHaveAttribute(
    "data-stone-direction",
    "lrTb",
  );
  const nextStart = await reader(page).getAttribute("data-end");
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect(reader(page)).toHaveAttribute("data-start", nextStart!);
  await ready(page);
  await page.getByRole("button", { name: "前のページ", exact: true }).click();
  await ready(page);
  await expect(reader(page)).toHaveAttribute("data-start", start!);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(errors).toEqual([]);
});

test("changing books and preparation modes cancels obsolete full-book work", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/read/000789");
  await ready(page);
  await chooseMode(page, "all");
  await expect(preparation(page)).toHaveAttribute("data-state", "running");
  await page.getByRole("link", { name: "本棚へ", exact: true }).click();
  await page
    .getByRole("button", { name: "駈込み訴えを読む", exact: true })
    .click();
  await ready(page);
  await expect(page.locator(".reader-title strong")).toHaveText("駈込み訴え");
  await completed(page);
  await expect(reader(page).locator(".reader-opening")).toHaveText(
    "駈込み訴え太宰治",
  );
  await chooseMode(page, "batch");
  await completed(page);
  await expect(preparation(page)).toHaveAttribute("data-mode", "batch");
  await chooseMode(page, "on-demand");
  await expect(preparation(page)).toHaveCount(0);
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await ready(page);
  await expect(reader(page)).not.toHaveAttribute("data-start", "0");
  await expect(page.locator(".reader-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});
