import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // These controls must work even when the optional web fonts are unavailable.
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});

test("theme cycles directly and independent typography controls preserve the passage", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/read/000277", { waitUntil: "domcontentloaded" });
  const rendered = page.getByTestId("reader-page");
  await expect(rendered.locator("svg")).toBeVisible();
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect(rendered).not.toHaveAttribute("data-start", "0");
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  const block = await rendered.getAttribute("data-block");
  const offset = await rendered.getAttribute("data-offset");
  const theme = page.getByRole("button", { name: /^配色を切り替え/u });
  const before = await rendered
    .locator("svg")
    .evaluate((node) => node.outerHTML);
  for (const [value, label] of [
    ["dark", "暗色"],
    ["light", "白"],
    ["paper", "生成り"],
  ]) {
    await theme.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", value);
    await expect(theme).toHaveText(label);
    expect(
      await rendered.locator("svg").evaluate((node) => node.outerHTML),
    ).toBe(before);
    await expect(page.locator("#reader-settings-panel")).toBeHidden();
  }
  const fontButton = page.getByRole("button", {
    name: "フォントサイズを調整",
    exact: true,
  });
  const spacingButton = page.getByRole("button", {
    name: "行送りを調整",
    exact: true,
  });
  await fontButton.click();
  const font = page.getByLabel("フォントサイズ", { exact: true });
  await expect(font).toBeFocused();
  await font.press("ArrowRight");
  await expect(font).toHaveValue("21");
  await expect(rendered).toHaveAttribute("data-block", block!);
  await expect(rendered).toHaveAttribute("data-offset", offset!);
  await page
    .getByRole("button", { name: "フォントサイズを大きくする", exact: true })
    .click();
  await expect(font).toHaveValue("22");
  await spacingButton.click();
  await expect(font).toHaveCount(0);
  await expect(fontButton).toHaveAttribute("aria-expanded", "false");
  const spacing = page.getByLabel("行送り", { exact: true });
  await spacing.fill("2.1");
  await page
    .getByRole("button", { name: "行送りを小さくする", exact: true })
    .click();
  await expect(spacing).toHaveValue("2.05");
  await expect(fontButton).toContainText("22px");
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(rendered).toHaveAttribute("data-block", block!);
  await expect(rendered).toHaveAttribute("data-offset", offset!);
  await spacing.press("Escape");
  await expect(spacing).toHaveCount(0);
  await expect(spacingButton).toBeFocused();
  await fontButton.click();
  await font.fill("48");
  await expect(
    page.getByRole("button", {
      name: "フォントサイズを大きくする",
      exact: true,
    }),
  ).toBeDisabled();
  await font.fill("22");
  await page.locator(".reader-title").click();
  await expect(font).toHaveCount(0);
  await theme.click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(rendered.locator("svg")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(fontButton).toContainText("22px");
  await expect(spacingButton).toHaveText("行送り");
  await spacingButton.click();
  await expect(spacing).toHaveValue("2.05");
  await spacing.press("Escape");
  await expect(rendered).toHaveAttribute("data-block", block!);
  await expect(rendered).toHaveAttribute("data-offset", offset!);
  expect(errors).toEqual([]);
});

test.describe("narrow reader", () => {
  test.use({ viewport: { width: 320, height: 700 } });
  test("quick controls and popovers fit a narrow screen without resizing the text area", async ({
    page,
  }) => {
    await page.goto("/#/read/000277", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("reader-page").locator("svg")).toBeVisible();
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    const viewport = page.getByTestId("reader-viewport");
    const before = await viewport.boundingBox();
    for (const name of ["フォントサイズを調整", "行送りを調整"]) {
      const button = page.getByRole("button", { name, exact: true });
      await button.click();
      const popup = page.locator(".reader-adjustment");
      await expect(popup).toBeVisible();
      expect(await viewport.boundingBox()).toEqual(before);
      const bounds = await popup.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
      await page
        .getByRole("button", { name: "調整を閉じる", exact: true })
        .click();
    }
    const buttons = await page
      .locator(".reader-toolbar")
      .getByRole("button", { name: /^(フォントサイズ|行送り)を調整$/u })
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            right: rect.right,
            height: rect.height,
          };
        }),
      );
    expect(new Set(buttons.map((button) => button.y)).size).toBe(1);
    await expect(
      page
        .locator(".reader-header")
        .getByRole("button", { name: /^配色を切り替え/u }),
    ).toBeVisible();
    for (const button of buttons) {
      expect(button.x).toBeGreaterThanOrEqual(0);
      expect(button.right).toBeLessThanOrEqual(320);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    expect(before!.height).toBeGreaterThan(80);
  });
});
