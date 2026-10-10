import { test, expect } from "@playwright/test";

test("the first page does not wait for the initial resize notification", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });
  await page.goto("/#/read/000127");
  await expect(page.getByTestId("reader-page").locator("svg")).toBeVisible();
  await expect(page.getByTestId("reader-page")).toHaveAttribute(
    "data-start",
    "0",
  );
});

test("browser history and clearing saved data keep reading usable", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/#/works/000127");
  await page
    .getByRole("button", { name: "この作品を読む", exact: true })
    .click();
  const rendered = page.getByTestId("reader-page");
  await expect(rendered.locator("svg")).toBeVisible();
  await page.getByRole("button", { name: "次のページ" }).click();
  await expect(rendered).not.toHaveAttribute("data-start", "0");
  const saved = await rendered.getAttribute("data-start");
  await page.getByRole("link", { name: "本棚へ", exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(20);
  await page.goBack();
  await expect(rendered).toHaveAttribute("data-start", saved!);
  await page
    .getByRole("button", { name: "この文庫について", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("dialog", { name: "この文庫について" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "端末内の保存データを削除" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "このページにしおりを挟む" }).click();
  await page.getByRole("button", { name: "しおり一覧を開く" }).click();
  await expect(page.locator(".bookmark-item")).toHaveCount(1);
  expect(failures).toEqual([]);
});

test("a failed catalog request on a reader deep link can be retried", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/data/catalog.json", (route) =>
    fail ? route.abort() : route.continue(),
  );
  await page.goto("/#/read/000127");
  await expect(
    page.getByRole("heading", { name: "本棚を読み込めませんでした" }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(page.getByTestId("reader-page").locator("svg")).toBeVisible();
});

test("layout retry repeats a failed canvas measurement at the same anchor", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const wrap = (prototype: {
      measureText: (text: string) => TextMetrics;
    }) => {
      const measure = prototype.measureText;
      prototype.measureText = function (text: string) {
        if (
          !(window as unknown as { allowMeasurement: boolean }).allowMeasurement
        )
          throw new Error("組版の再試行テスト");
        return measure.call(this, text);
      };
    };
    wrap(CanvasRenderingContext2D.prototype);
    if (typeof OffscreenCanvasRenderingContext2D !== "undefined")
      wrap(OffscreenCanvasRenderingContext2D.prototype);
  });
  await page.goto("/#/read/000127");
  await expect(page.getByRole("alert")).toContainText("組版の再試行テスト");
  await page.evaluate(() => {
    (window as unknown as { allowMeasurement: boolean }).allowMeasurement =
      true;
  });
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(page.getByTestId("reader-page").locator("svg")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("catalog, vertical/horizontal reading, position restoration, bookmarks and themes", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(20);
  await page.getByRole("searchbox").fill("らしょうもん");
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.locator(".book-card h3 a").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "この作品を読む", exact: true })
    .click();
  const rendered = page.getByTestId("reader-page");
  await expect(rendered.locator("svg")).toHaveAttribute(
    "data-stone-direction",
    "tbRl",
  );
  await expect(rendered.locator(".reader-rubies tspan").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "次のページ" })).toBeEnabled();
  const start = await rendered.getAttribute("data-start");
  const end = await rendered.getAttribute("data-end");
  await page.getByRole("button", { name: "次のページ" }).click();
  await expect(rendered).toHaveAttribute("data-start", end!);
  await page.getByRole("button", { name: "前のページ" }).click();
  await expect(rendered).toHaveAttribute("data-start", start!);
  await page.getByRole("button", { name: "次のページ" }).click();
  const savedBlock = await rendered.getAttribute("data-block");
  const savedOffset = await rendered.getAttribute("data-offset");
  await page.getByRole("button", { name: "このページにしおりを挟む" }).click();
  await page.getByRole("button", { name: "横書きに切り替え" }).click();
  await expect(rendered.locator("svg")).toHaveAttribute(
    "data-stone-direction",
    "lrTb",
  );
  await expect(rendered).toHaveAttribute("data-block", savedBlock!);
  await expect(rendered).toHaveAttribute("data-offset", savedOffset!);
  await page.getByRole("button", { name: "読書設定を開く" }).click();
  await page.getByLabel("フォントサイズ").fill("28");
  await page.getByRole("button", { name: "暗色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(rendered).toHaveAttribute("data-block", savedBlock!);
  await expect(rendered).toHaveAttribute("data-offset", savedOffset!);
  await page.reload();
  await expect(rendered.locator("svg")).toHaveAttribute(
    "data-stone-direction",
    "lrTb",
  );
  await expect(rendered).toHaveAttribute("data-block", savedBlock!);
  await expect(rendered).toHaveAttribute("data-offset", savedOffset!);
  await page.getByRole("button", { name: "しおり一覧を開く" }).click();
  await expect(page.locator(".bookmark-item")).toHaveCount(1);
  await page.getByRole("button", { name: "しおりを削除" }).click();
  await expect(page.locator(".bookmark-item")).toHaveCount(0);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  expect(failures).toEqual([]);
});

test("long book, contents, missing route and denied storage remain usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Denied", "SecurityError");
    };
  });
  await page.goto("/#/read/000789");
  await expect(page.getByTestId("reader-page").locator("svg")).toBeVisible();
  await expect(page.locator(".save-warning")).toBeVisible();
  await page.getByRole("button", { name: "目次を開く" }).click();
  const entries = page.locator(".toc-list button");
  await expect(entries).toHaveCount(12);
  await entries.last().click();
  await expect(page.getByTestId("reader-page")).not.toHaveAttribute(
    "data-start",
    "0",
  );
  expect(
    await page.locator('[data-testid="reader-page"] tspan').count(),
  ).toBeLessThan(5000);
  await page.goto("/#/read/missing");
  await expect(
    page.getByRole("heading", { name: "この作品は本棚にありません" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "本棚に戻る", exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(20);
});

test("screen layout stays inside a narrow viewport and image assets load", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 640 },
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(20);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page.goto("/#/read/000127");
  await expect(page.getByTestId("reader-page").locator("svg")).toBeVisible();
  const viewport = page.getByTestId("reader-viewport");
  const rendered = page.getByTestId("reader-page");
  const bounds = await viewport.boundingBox();
  const glyphs = await rendered.locator("svg").evaluate((svg) => {
    const root = svg.getBoundingClientRect();
    return [...svg.querySelectorAll("tspan")]
      .filter((el) => el.textContent?.trim())
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x - root.x,
          y: r.y - root.y,
          right: r.right - root.x,
          bottom: r.bottom - root.y,
        };
      });
  });
  expect(bounds).not.toBeNull();
  for (const glyph of glyphs) {
    expect(glyph.x).toBeGreaterThanOrEqual(-2);
    expect(glyph.y).toBeGreaterThanOrEqual(-2);
    expect(glyph.right).toBeLessThanOrEqual(bounds!.width + 2);
    expect(glyph.bottom).toBeLessThanOrEqual(bounds!.height + 2);
  }
  await context.close();
});
