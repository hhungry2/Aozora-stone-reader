import { expect, test, type Locator } from "@playwright/test";

// Browser rectangle measurements may round a CSS pixel by a tiny fraction.
const minimumTargetSize = 44 - 0.01;

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  const rectangle = await locator.boundingBox();
  expect(rectangle).not.toBeNull();
  return rectangle!;
}

async function expectSingleToolbarRow(footer: Locator) {
  const centers = await footer.getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return rect.y + rect.height / 2;
    }),
  );
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
}

test("reading actions sit in the header and the footer keeps settings, paging and contents in order", async ({
  page,
}) => {
  await page.goto("/#/read/000752", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("reader-page").locator("svg")).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  const header = page.locator(".reader-header");
  const footer = page.locator(".reader-toolbar");
  const theme = header.getByRole("button", { name: /^配色を切り替え/u });
  const bookmark = header.getByRole("button", {
    name: "このページにしおりを挟む",
    exact: true,
  });
  const bookmarkList = header.getByRole("button", {
    name: "しおり一覧を開く",
    exact: true,
  });
  await expect(theme).toBeVisible();
  await expect(bookmark).toHaveText("しおり");
  await expect(bookmarkList).toHaveCount(0);
  await bookmark.click();
  const mark = await bounds(bookmark);
  const list = await bounds(bookmarkList);
  expect(list.x).toBeGreaterThanOrEqual(mark.x + mark.width - 1);
  expect(list.x - mark.x - mark.width).toBeLessThanOrEqual(12);
  expect(
    Math.abs(list.y + list.height / 2 - mark.y - mark.height / 2),
  ).toBeLessThanOrEqual(1);
  await expect(page.locator(".reader-running-head")).toHaveCount(0);
  await expect(
    footer.getByRole("button", { name: "しおり一覧を開く", exact: true }),
  ).toHaveCount(0);
  await expect(
    footer.getByRole("button", {
      name: "このページにしおりを挟む",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    header.getByRole("button", { name: "フォントサイズを調整", exact: true }),
  ).toHaveCount(0);
  await expect(
    header.getByRole("button", { name: "行送りを調整", exact: true }),
  ).toHaveCount(0);
  await expect(
    footer.getByRole("button", { name: "フォントサイズを調整", exact: true }),
  ).toBeVisible();
  await expect(
    footer.getByRole("button", { name: "行送りを調整", exact: true }),
  ).toBeVisible();

  const contents = await bounds(
    footer.getByRole("button", { name: "目次を開く", exact: true }),
  );
  const paging = await bounds(footer.locator(".page-controls"));
  const settings = await bounds(
    footer.getByRole("button", { name: "読書設定を開く", exact: true }),
  );
  const toolbar = await bounds(footer);
  expect(settings.x + settings.width).toBeLessThanOrEqual(paging.x);
  expect(paging.x + paging.width).toBeLessThanOrEqual(contents.x);
  await expectSingleToolbarRow(footer);
  if (page.viewportSize()!.width > 900) {
    expect(
      Math.abs(paging.x + paging.width / 2 - toolbar.x - toolbar.width / 2),
    ).toBeLessThanOrEqual(12);
  }

  await bookmarkList.click();
  const bookmarks = page.getByRole("dialog", {
    name: "挟んだしおり",
    exact: true,
  });
  await expect(bookmarks).toBeVisible();
  await expect(bookmarks.locator(".bookmark-item")).toHaveCount(1);
  await bookmarks
    .getByRole("button", { name: "しおりを削除", exact: true })
    .click();
  await expect(bookmarks).toHaveCount(0);
  await expect(bookmarkList).toHaveCount(0);
  await footer.getByRole("button", { name: "目次を開く", exact: true }).click();
  const toc = page.getByRole("dialog", { name: "目次", exact: true });
  await expect(toc).toBeVisible();
  await toc.getByRole("button", { name: "閉じる", exact: true }).click();
  await footer
    .getByRole("button", { name: "読書設定を開く", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "読書の設定" }),
  ).toBeVisible();
  await expect(page.getByLabel("文字方向", { exact: true })).toHaveCount(0);
  await header
    .getByRole("button", { name: "横書きに切り替え", exact: true })
    .click();
  await expect(page.getByTestId("reader-page").locator("svg")).toHaveAttribute(
    "data-stone-direction",
    "lrTb",
  );
  await footer
    .getByRole("button", { name: "読書設定を閉じる", exact: true })
    .click();
  await expect(page.getByTestId("reader-page")).toHaveAttribute(
    "data-start",
    "0",
  );
});

for (const width of [320, 795]) {
  test.describe(`reader layout at ${width}px`, () => {
    test.use({ viewport: { width, height: 700 } });

    test("header and footer targets fit the screen and typography adjustments open above the footer", async ({
      page,
    }) => {
      await page.goto("/#/read/000277", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByTestId("reader-page").locator("svg"),
      ).toBeVisible();
      await expect(page.locator(".reader-loading")).toHaveCount(0);
      const viewport = page.getByTestId("reader-viewport");
      const before = await bounds(viewport);
      expect(before.height).toBeGreaterThan(80);
      const header = page.locator(".reader-header");
      const footer = page.locator(".reader-toolbar");
      await expect(
        footer.getByRole("button", { name: "目次を開く" }),
      ).toHaveCount(0);
      await expect(
        header.getByRole("button", { name: "しおり一覧を開く" }),
      ).toHaveCount(0);
      await expectSingleToolbarRow(footer);
      const headerTargets = [
        header.getByRole("link", { name: "本棚へ", exact: true }),
        ...(await header.getByRole("button").all()),
      ];
      const footerTargets = await footer.getByRole("button").all();
      for (const target of [...headerTargets, ...footerTargets]) {
        const rectangle = await bounds(target);
        expect(rectangle.x).toBeGreaterThanOrEqual(0);
        expect(rectangle.y).toBeGreaterThanOrEqual(0);
        expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(width);
        expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(700);
        expect(rectangle.width).toBeGreaterThan(0);
        expect(rectangle.height).toBeGreaterThan(0);
      }
      for (const target of headerTargets) {
        await expect(target).toBeEnabled();
        await target.click({ trial: true });
      }
      for (const target of footerTargets) {
        const rectangle = await bounds(target);
        expect(rectangle.width).toBeGreaterThanOrEqual(minimumTargetSize);
        expect(rectangle.height).toBeGreaterThanOrEqual(minimumTargetSize);
      }
      for (const target of [
        header.getByRole("button", { name: /^配色を切り替え/u }),
        header.getByRole("button", {
          name: "このページにしおりを挟む",
          exact: true,
        }),
      ]) {
        expect((await bounds(target)).height).toBeGreaterThanOrEqual(
          minimumTargetSize,
        );
      }
      for (const name of ["フォントサイズを調整", "行送りを調整"]) {
        const trigger = footer.getByRole("button", { name, exact: true });
        const button = await bounds(trigger);
        await trigger.click();
        const popup = footer.locator(".reader-adjustment");
        const rectangle = await bounds(popup);
        expect(rectangle.x).toBeGreaterThanOrEqual(0);
        expect(rectangle.y).toBeGreaterThanOrEqual(0);
        expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(width);
        expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(button.y);
        expect(await viewport.boundingBox()).toEqual(before);
        for (const control of await popup.getByRole("button").all()) {
          const target = await bounds(control);
          expect(target.width).toBeGreaterThanOrEqual(minimumTargetSize);
          expect(target.height).toBeGreaterThanOrEqual(minimumTargetSize);
        }
        await popup
          .getByRole("button", { name: "調整を閉じる", exact: true })
          .click();
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      const toolbar = await bounds(footer);
      expect(before.y + before.height).toBeLessThanOrEqual(toolbar.y);
    });
  });
}
