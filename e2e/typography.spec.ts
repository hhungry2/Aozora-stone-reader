import { expect, test } from "@playwright/test";

test("the updated site name fits the library and the removed headings stay absent", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(20);
  await expect(page.locator(".site-header .brand strong")).toHaveText(
    "縦・横表示対応の青空文庫リーダー",
  );
  await expect(page).toHaveTitle("縦・横表示対応の青空文庫リーダー");
  await expect(page.getByText("一冊と、", { exact: false })).toHaveCount(0);
  await expect(page.getByText("静かな時間を。", { exact: false })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("何度でも読みたい、言葉があります。", { exact: true }),
  ).toHaveCount(0);
  const widths = await page.evaluate(() => ({
    window: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.window);
  const brand = await page.locator(".site-header .brand").boundingBox();
  const nav = await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .boundingBox();
  expect(brand!.x + brand!.width).toBeLessThanOrEqual(nav!.x + 1);
});

test("all playground typography settings reflow at the same anchor and persist", async ({
  page,
}) => {
  // Font network availability must not decide whether settings and reading work.
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto("/#/read/000127");
  const rendered = page.getByTestId("reader-page");
  await expect(rendered.locator("svg")).toBeVisible();
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect(rendered).not.toHaveAttribute("data-start", "0");
  const savedBlock = await rendered.getAttribute("data-block");
  const savedOffset = await rendered.getAttribute("data-offset");
  await page
    .getByRole("button", { name: "このページにしおりを挟む", exact: true })
    .click();
  const settingsPanel = page.getByRole("complementary", { name: "読書の設定" });
  await expect(settingsPanel).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const textBounds = await page.getByTestId("reader-viewport").boundingBox();
  const settingsBounds = await settingsPanel.boundingBox();
  expect(textBounds!.width).toBeGreaterThan(200);
  expect(textBounds!.height).toBeGreaterThan(80);
  expect(
    textBounds!.x + textBounds!.width <= settingsBounds!.x + 1 ||
      textBounds!.y + textBounds!.height <= settingsBounds!.y + 1,
  ).toBe(true);
  await settingsPanel
    .getByLabel("文字方向", { exact: true })
    .selectOption("lrTb");
  await settingsPanel.getByLabel("約物", { exact: true }).selectOption("whole");
  await settingsPanel
    .getByLabel("文字寄せ", { exact: true })
    .selectOption("center");
  await settingsPanel
    .getByLabel("行の寄せ", { exact: true })
    .selectOption("end");
  await settingsPanel.getByLabel("フォントサイズ", { exact: true }).fill("21");
  await settingsPanel.getByLabel("行送り", { exact: true }).fill("1.8");
  await settingsPanel
    .getByLabel("和文フォント", { exact: true })
    .selectOption("noto-sans");
  await settingsPanel
    .getByLabel("欧文フォント", { exact: true })
    .selectOption("times");
  await settingsPanel.getByLabel("欧文スケール", { exact: true }).fill("0.83");
  for (const label of ["禁則処理", "単語で改行（単語を分割しない）", "縦中横"])
    await settingsPanel.getByLabel(label, { exact: true }).uncheck();
  await settingsPanel.getByLabel("文字の枠を表示", { exact: true }).check();
  await settingsPanel
    .getByRole("button", { name: "暗色", exact: true })
    .click();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(rendered).toHaveAttribute("data-block", savedBlock!);
  await expect(rendered).toHaveAttribute("data-offset", savedOffset!);
  await expect(rendered.locator("svg")).toHaveAttribute(
    "data-stone-direction",
    "lrTb",
  );
  expect(
    await rendered.locator(".reader-glyph-frames rect").count(),
  ).toBeGreaterThan(10);
  await expect(rendered.locator("svg [data-run]").first()).toHaveAttribute(
    "font-family",
    /Noto Sans JP/u,
  );
  await page.reload();
  await expect(rendered.locator("svg")).toBeVisible();
  await expect(rendered).toHaveAttribute("data-block", savedBlock!);
  await expect(rendered).toHaveAttribute("data-offset", savedOffset!);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "しおり一覧を開く", exact: true })
    .click();
  await expect(page.locator(".bookmark-item")).toHaveCount(1);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  for (const [label, value] of [
    ["文字方向", "lrTb"],
    ["約物", "whole"],
    ["文字寄せ", "center"],
    ["行の寄せ", "end"],
    ["フォントサイズ", "21"],
    ["行送り", "1.8"],
    ["和文フォント", "noto-sans"],
    ["欧文フォント", "times"],
    ["欧文スケール", "0.83"],
  ])
    await expect(settingsPanel.getByLabel(label, { exact: true })).toHaveValue(
      value,
    );
  for (const label of ["禁則処理", "単語で改行（単語を分割しない）", "縦中横"])
    await expect(
      settingsPanel.getByLabel(label, { exact: true }),
    ).not.toBeChecked();
  await expect(
    settingsPanel.getByLabel("文字の枠を表示", { exact: true }),
  ).toBeChecked();
  await settingsPanel
    .getByRole("button", { name: "初期設定に戻す", exact: true })
    .click();
  await expect(
    settingsPanel.getByLabel("文字方向", { exact: true }),
  ).toHaveValue("tbRl");
  await expect(
    settingsPanel.getByLabel("フォントサイズ", { exact: true }),
  ).toHaveValue("20");
  await expect(
    settingsPanel.getByLabel("禁則処理", { exact: true }),
  ).toBeChecked();
  await expect(
    settingsPanel.getByLabel("文字の枠を表示", { exact: true }),
  ).not.toBeChecked();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(rendered.locator(".reader-glyph-frames")).toHaveCount(0);
  await expect(rendered).toHaveAttribute("data-block", savedBlock!);
  await expect(rendered).toHaveAttribute("data-offset", savedOffset!);
});
