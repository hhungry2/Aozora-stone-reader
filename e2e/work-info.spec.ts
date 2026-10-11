import { expect, test } from "@playwright/test";
import catalog from "../public/data/catalog.json" with { type: "json" };

test("book covers and legacy work links open the same book directly in the reader", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(
    Math.min(40, catalog.length),
  );
  await page.getByRole("searchbox").fill("河童 芥川");
  await page
    .locator('.book-card:has(a[href="#/read/000069"]) .book-cover-button')
    .click();
  await expect(page).toHaveURL(/#\/read\/000069$/u);
  await expect(page.getByTestId("reader-page").locator("svg")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  for (const [id, title] of [
    ["000069", "河童"],
    ["000277", "駈込み訴え"],
  ]) {
    await page.goto(`/#/works/${id}`);
    await expect(page).toHaveURL(new RegExp(`#/read/${id}$`, "u"));
    await expect(page.locator(".reader-title strong")).toHaveText(title);
    await expect(page.getByTestId("reader-page").locator("svg")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("link", { name: "本棚へ", exact: true }).click();
    await expect(page.locator(".book-card")).toHaveCount(
      Math.min(40, catalog.length),
    );
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`#/read/${id}$`, "u"));
    await expect(page.getByTestId("reader-page").locator("svg")).toBeVisible();
  }
  await page.goto("/#/works/missing");
  await expect(page).toHaveURL(/#\/read\/missing$/u);
  await expect(
    page.getByRole("heading", { name: "この作品は本棚にありません" }),
  ).toBeVisible();
});

test("work information stays inside the reader and restarting preserves bookmarks", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/#/read/000277");
  const rendered = page.getByTestId("reader-page");
  const info = page.locator("#reader-work-info");
  const toggle = page.locator(
    '.reader-header button[aria-controls="reader-work-info"]',
  );
  const content = page.getByRole("region", { name: "作品情報の詳細" });
  await expect(rendered.locator("svg")).toBeVisible();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(content).toBeHidden();
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect(rendered).not.toHaveAttribute("data-start", "0");
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  const block = await rendered.getAttribute("data-block");
  const offset = await rendered.getAttribute("data-offset");
  await page.getByRole("button", { name: "このページにしおりを挟む" }).click();

  await toggle.click();
  await expect(content).toBeVisible();
  await expect(content).toContainText("約27分 · 13,490文字");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    content.getByRole("heading", { name: "駈込み訴え", exact: true }),
  ).toBeVisible();
  await expect(
    content.getByRole("link", { name: "青空文庫の図書カード" }),
  ).toHaveAttribute(
    "href",
    "https://www.aozora.gr.jp/cards/000035/card277.html",
  );
  await content.locator(".reader-credits > summary").click();
  await expect(content.locator(".credits")).toBeVisible();
  await expect(content.locator(".credits")).toContainText("入力：文咲苺子");
  await expect(rendered).toHaveAttribute("data-block", block!);
  await expect(rendered).toHaveAttribute("data-offset", offset!);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  expect(
    (await page.getByTestId("reader-viewport").boundingBox())!.height,
  ).toBeGreaterThan(80);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);

  await page.getByRole("button", { name: "読書設定を開く" }).click();
  await expect(info).toBeHidden();
  await expect(
    page.getByRole("complementary", { name: "読書の設定" }),
  ).toBeVisible();
  await toggle.click();
  await expect(content).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "読書の設定" }),
  ).toBeHidden();
  await content
    .getByRole("button", { name: "最初から読む", exact: true })
    .click();
  await expect(rendered).toHaveAttribute("data-start", "0");
  await expect(info).toBeHidden();
  await expect(rendered.locator(".reader-opening")).toHaveText(
    "駈込み訴え太宰治",
  );
  await page.getByRole("button", { name: "しおり一覧を開く" }).click();
  await expect(page.locator(".bookmark-item")).toHaveCount(1);
  expect(failures).toEqual([]);
});
