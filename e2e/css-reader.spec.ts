import { expect, test, type Page } from "@playwright/test";
import { defaultSettings, type Book, type ReaderSettings } from "../src/types";

const rendered = (page: Page) => page.getByTestId("reader-page");
const cssReader = (page: Page) => page.getByTestId("css-reader");
const settingsPanel = (page: Page) =>
  page.getByRole("complementary", { name: "読書の設定" });

async function seedSettings(page: Page, preferences: Partial<ReaderSettings>) {
  await page.addInitScript(
    (settings) => {
      if (!localStorage.getItem("aozora-stone-reader:v1:settings")) {
        localStorage.setItem(
          "aozora-stone-reader:v1:settings",
          JSON.stringify({ ...settings, settingsVersion: 2 }),
        );
      }
    },
    { ...defaultSettings, ...preferences },
  );
}

async function ready(page: Page, mode: "stone" | "css") {
  await expect(page.getByTestId("reader")).toHaveAttribute("data-engine", mode);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  if (mode === "css") {
    await expect(cssReader(page)).toBeVisible();
    await expect(rendered(page).locator("svg")).toHaveCount(0);
    await expect(
      cssReader(page).locator("[data-css-block]").first(),
    ).toBeAttached();
  } else {
    await expect(rendered(page).locator("svg").first()).toBeVisible();
  }
}

async function openSettings(page: Page) {
  await page
    .getByRole("button", { name: "読書設定を開く", exact: true })
    .click();
  await expect(settingsPanel(page)).toBeVisible();
}

async function closeSettings(page: Page) {
  await page
    .getByRole("button", { name: "読書設定を閉じる", exact: true })
    .click();
  await expect(settingsPanel(page)).toBeHidden();
}

async function chooseEngine(page: Page, mode: "stone" | "css") {
  await settingsPanel(page)
    .getByLabel("表示エンジン", { exact: true })
    .selectOption(mode);
  await ready(page, mode);
}

async function anchorPosition(page: Page, bookId: string) {
  const blockId = await rendered(page).getAttribute("data-block");
  const offset = Number(await rendered(page).getAttribute("data-offset"));
  return page.evaluate(
    async ({ bookId, blockId, offset }) => {
      const book = await (await fetch(`data/books/${bookId}.json`)).json();
      let start = 0;
      for (const block of book.blocks as { id: string; text: string }[]) {
        if (block.id === blockId) return start + offset;
        start += block.text.length + 1;
      }
      throw new Error(`Missing source block ${blockId}`);
    },
    { bookId, blockId, offset },
  );
}

async function expectPassage(page: Page, sourcePosition: number) {
  await expect
    .poll(async () => {
      const start = Number(await rendered(page).getAttribute("data-start"));
      const end = Number(await rendered(page).getAttribute("data-end"));
      return start <= sourcePosition && end > sourcePosition;
    })
    .toBe(true);
}

test("saved CSS mode loads native vertical and horizontal text without loading Stone", async ({
  page,
}) => {
  const stoneRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      /stone-engine|\/src\/reader\/(?:engine|ReaderPage|ReaderPages)\./u.test(
        request.url(),
      )
    ) {
      stoneRequests.push(request.url());
    }
  });
  await seedSettings(page, { renderingMode: "css" });
  await page.goto("/#/read/000127");
  await ready(page, "css");
  await expect(cssReader(page)).toHaveAttribute(
    "data-writing-mode",
    "vertical-rl",
  );
  await expect(cssReader(page).locator(".css-reader-document")).toHaveCSS(
    "writing-mode",
    "vertical-rl",
  );
  expect(await cssReader(page).locator("ruby rt").count()).toBeGreaterThan(0);
  const sourceText = await page.evaluate(async () => {
    const book = await (await fetch("data/books/000127.json")).json();
    return book.blocks.map((block: { text: string }) => block.text);
  });
  const nativeText = await cssReader(page)
    .locator("[data-css-block]")
    .evaluateAll((blocks) =>
      blocks.map((block) => {
        const copy = block.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("rt, rp").forEach((ruby) => ruby.remove());
        return copy.textContent;
      }),
    );
  expect(nativeText).toEqual(sourceText);
  await openSettings(page);
  await expect(
    settingsPanel(page).getByLabel("表示エンジン", { exact: true }),
  ).toHaveValue("css");
  await settingsPanel(page)
    .getByRole("switch", { name: "ルビを表示", exact: true })
    .click();
  await expect(cssReader(page).locator("rt")).toHaveCount(0);
  await settingsPanel(page)
    .getByRole("switch", { name: "ルビを表示", exact: true })
    .click();
  expect(await cssReader(page).locator("ruby rt").count()).toBeGreaterThan(0);
  await closeSettings(page);
  await page
    .getByRole("button", { name: "横書きに切り替え", exact: true })
    .click();
  await ready(page, "css");
  await expect(cssReader(page)).toHaveAttribute(
    "data-writing-mode",
    "horizontal-tb",
  );
  await expect(cssReader(page).locator(".css-reader-document")).toHaveCSS(
    "writing-mode",
    "horizontal-tb",
  );
  const horizontalStart = Number(
    await rendered(page).getAttribute("data-start"),
  );
  await cssReader(page).press("PageDown");
  await expect
    .poll(async () => Number(await rendered(page).getAttribute("data-start")))
    .toBeGreaterThan(horizontalStart);
  await cssReader(page).press("PageUp");
  await expect(rendered(page)).toHaveAttribute(
    "data-start",
    String(horizontalStart),
  );
  expect(stoneRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("engine switching preserves the passage and CSS paging, bookmarks, TOC and reload remain usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/read/000752");
  await ready(page, "stone");
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await ready(page, "stone");
  await expect(rendered(page)).not.toHaveAttribute("data-start", "0");
  await openSettings(page);
  await ready(page, "stone");
  const stonePosition = await anchorPosition(page, "000752");
  await chooseEngine(page, "css");
  await expectPassage(page, stonePosition);
  const cssPosition = await anchorPosition(page, "000752");
  await chooseEngine(page, "stone");
  await expectPassage(page, cssPosition);
  await chooseEngine(page, "css");
  await closeSettings(page);
  await ready(page, "css");
  const original = Number(await rendered(page).getAttribute("data-start"));
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect
    .poll(async () => Number(await rendered(page).getAttribute("data-start")))
    .toBeGreaterThan(original);
  await page.getByRole("button", { name: "前のページ", exact: true }).click();
  await expect(rendered(page)).toHaveAttribute("data-start", String(original));
  const bookmarkPosition = await anchorPosition(page, "000752");
  await page
    .getByRole("button", { name: "このページにしおりを挟む", exact: true })
    .click();
  await page.getByRole("button", { name: "目次を開く", exact: true }).click();
  const chapters = page.locator(".toc-list > button");
  await expect(chapters).toHaveCount(12);
  await chapters.last().click();
  await ready(page, "css");
  await expect
    .poll(async () => Number(await rendered(page).getAttribute("data-start")))
    .toBeGreaterThan(bookmarkPosition);
  await page
    .getByRole("button", { name: "しおり一覧を開く", exact: true })
    .click();
  await expect(page.locator(".bookmark-item")).toHaveCount(1);
  await page.locator(".bookmark-jump").click();
  await ready(page, "css");
  await expectPassage(page, bookmarkPosition);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("aozora-stone-reader:v1:settings")!)
            .renderingMode,
      ),
    )
    .toBe("css");
  const beforeReload = await anchorPosition(page, "000752");
  await page.reload();
  await ready(page, "css");
  await expectPassage(page, beforeReload);
  await openSettings(page);
  await expect(
    settingsPanel(page).getByLabel("表示エンジン", { exact: true }),
  ).toHaveValue("css");
  expect(errors).toEqual([]);
});

test("narrow CSS reading ignores Stone preparation and spread settings while reflowing at the same passage", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 720 },
  });
  const page = await context.newPage();
  try {
    await seedSettings(page, {
      renderingMode: "css",
      paginationMode: "all",
      pageLayout: "spread",
    });
    await page.goto("/#/read/000127");
    await ready(page, "css");
    await expect(page.getByTestId("pagination-preload")).toHaveCount(0);
    await expect(rendered(page)).toHaveAttribute("data-layout", "single");
    await page.getByRole("button", { name: "次のページ", exact: true }).click();
    await expect(rendered(page)).not.toHaveAttribute("data-start", "0");
    const position = await anchorPosition(page, "000127");
    await openSettings(page);
    for (const label of [
      "ページの準備",
      "約物",
      "行の寄せ",
      "文字の枠を表示",
    ]) {
      await expect(
        settingsPanel(page).getByLabel(label, { exact: true }),
      ).toBeDisabled();
    }
    await expect(page.locator(".page-layout-toggle")).toBeHidden();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("aozora-stone-reader:v1:settings")!)
            .pageLayout,
      ),
    ).toBe("spread");
    await expect(
      settingsPanel(page).getByLabel("ページの準備", { exact: true }),
    ).toHaveValue("all");
    await closeSettings(page);
    await page
      .getByRole("button", { name: "フォントサイズを調整", exact: true })
      .click();
    await page.getByLabel("フォントサイズ", { exact: true }).fill("28");
    await page
      .getByRole("button", { name: "行送りを調整", exact: true })
      .click();
    await page.getByLabel("行送り", { exact: true }).fill("2.2");
    await page
      .getByRole("button", { name: "調整を閉じる", exact: true })
      .click();
    await ready(page, "css");
    await expectPassage(page, position);
    await expect(cssReader(page).locator(".css-reader-document")).toHaveCSS(
      "font-size",
      "28px",
    );
    await expect
      .poll(() =>
        cssReader(page)
          .locator(".css-reader-document")
          .evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).lineHeight),
          ),
      )
      .toBeCloseTo(61.6, 2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await expect(page.getByTestId("pagination-preload")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("CSS uses source HTML ruby, emphasis and images without changing source characters", async ({
  page,
}) => {
  const pixel =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
  const paragraph = "前書き。漢字12強調\ufffc終わり。";
  const afterword = "後書き。𠮷と、か\u3099を含む。";
  await page.route("**/__css-reader-fixture/*.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(pixel, "base64"),
    }),
  );
  await page.route("**/data/books/000127.json", async (route) => {
    const response = await route.fetch();
    const book = (await response.json()) as Book;
    const plain = { rubies: [], emphasis: [], inlineImages: [], indent: 0 };
    book.blocks = [
      { ...plain, id: "chapter", kind: "heading", text: "第一章", level: 1 },
      {
        ...plain,
        id: "annotated",
        kind: "paragraph",
        text: paragraph,
        rubies: [{ start: 4, end: 6, reading: "かんじ" }],
        emphasis: [{ start: 8, end: 10, kind: "sesame-dot" }],
        inlineImages: [
          {
            start: 10,
            end: 11,
            src: "__css-reader-fixture/inline.png",
            alt: "本文中の図",
            sourceUrl: "https://example.test/inline.png",
          },
        ],
      },
      {
        ...plain,
        id: "picture",
        kind: "image",
        text: "",
        image: {
          src: "__css-reader-fixture/picture.png",
          alt: "独立した挿絵",
          sourceUrl: "https://example.test/picture.png",
        },
      },
      { ...plain, id: "afterword", kind: "paragraph", text: afterword },
    ];
    book.toc = [{ title: "第一章", blockId: "chapter", level: 1 }];
    await route.fulfill({ response, json: book });
  });
  await seedSettings(page, { renderingMode: "css" });
  await page.goto("/#/read/000127");
  await ready(page, "css");
  const body = cssReader(page).locator('[data-css-block="annotated"]');
  await expect(body.locator("ruby rt")).toHaveText("かんじ");
  await expect(
    body.getByRole("img", { name: "本文中の図", exact: true }),
  ).toHaveAttribute("src", "/__css-reader-fixture/inline.png");
  await expect(
    cssReader(page).getByRole("img", { name: "独立した挿絵", exact: true }),
  ).toHaveAttribute("src", "/__css-reader-fixture/picture.png");
  for (const image of await cssReader(page).locator("img").all()) {
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
  expect(
    await body.evaluate((element) => {
      const emphasized = [...element.querySelectorAll<HTMLElement>("*")].filter(
        (child) =>
          getComputedStyle(child).textEmphasisStyle !== "none" &&
          child.textContent === "強調",
      );
      return emphasized.length;
    }),
  ).toBeGreaterThan(0);
  const sourceText = await body.evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("rt, rp").forEach((ruby) => ruby.remove());
    copy
      .querySelectorAll("img")
      .forEach((image) => image.replaceWith("\ufffc"));
    return copy.textContent;
  });
  expect(sourceText).toBe(paragraph);
  await expect(
    cssReader(page).locator('[data-css-block="afterword"]'),
  ).toHaveText(afterword);
  await expect(rendered(page).locator("svg")).toHaveCount(0);
});

test("CSS paging makes a partially clipped edge character fully visible in both directions", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 321, height: 721 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.route("**/data/books/000127.json", async (route) => {
      const response = await route.fetch();
      const book = (await response.json()) as Book;
      book.blocks = [
        {
          id: "long-fixture",
          kind: "paragraph",
          text: "あいうえお".repeat(1000),
          rubies: [],
          emphasis: [],
          inlineImages: [],
          indent: 0,
        },
      ];
      book.toc = [];
      await route.fulfill({ response, json: book });
    });
    await seedSettings(page, {
      renderingMode: "css",
      fontSize: 20,
      lineHeight: 1.9,
    });
    await page.goto("/#/read/000127");
    await ready(page, "css");
    for (const vertical of [true, false]) {
      if (!vertical) {
        await page
          .getByRole("button", { name: "横書きに切り替え", exact: true })
          .click();
        await ready(page, "css");
        await expect(cssReader(page)).toHaveAttribute(
          "data-writing-mode",
          "horizontal-tb",
        );
      }
      let clipped: { offset: number; length: number } | null = null;
      for (const offset of [0, 1, 5, 10, 15, 20, 25, 30]) {
        // Native scrolling can stop between lines; reproduce a real cut glyph, rather than assuming a font's exact metrics.
        await cssReader(page).evaluate(
          (root, { vertical, offset }) => {
            if (vertical) root.scrollLeft = -offset;
            else root.scrollTop = offset;
            return new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            );
          },
          { vertical, offset },
        );
        clipped = await cssReader(page).evaluate((root, vertical) => {
          const bounds = root.getBoundingClientRect();
          const extent = vertical ? root.clientWidth : root.clientHeight;
          const node = root.querySelector(
            '[data-css-block="long-fixture"] [data-css-run]',
          )!.firstChild!;
          for (let offset = 0; offset < node.textContent!.length; offset++) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            const start = vertical
              ? bounds.right - rect.right
              : rect.top - bounds.top;
            const end = vertical
              ? bounds.right - rect.left
              : rect.bottom - bounds.top;
            if (start < extent - 0.5 && end > extent + 0.5)
              return { offset, length: 1 };
          }
          return null;
        }, vertical);
        if (clipped) break;
      }
      expect(
        clipped,
        `${vertical ? "Vertical" : "Horizontal"} fixture must exercise a clipped source character`,
      ).not.toBeNull();
      const target = clipped!;
      const originalScroll = await cssReader(page).evaluate(
        (root, vertical) => (vertical ? -root.scrollLeft : root.scrollTop),
        vertical,
      );
      await page
        .getByRole("button", { name: "次のページ", exact: true })
        .click();
      await expect
        .poll(() =>
          cssReader(page).evaluate(
            (root, { target, vertical }) => {
              const node = root.querySelector(
                '[data-css-block="long-fixture"] [data-css-run]',
              )!.firstChild!;
              const range = document.createRange();
              range.setStart(node, target.offset);
              range.setEnd(node, target.offset + target.length);
              const rect = range.getBoundingClientRect();
              const bounds = root.getBoundingClientRect();
              const start = vertical
                ? bounds.right - rect.right
                : rect.top - bounds.top;
              const end = vertical
                ? bounds.right - rect.left
                : rect.bottom - bounds.top;
              const extent = vertical ? root.clientWidth : root.clientHeight;
              return start >= -0.5 && end <= extent + 0.5;
            },
            { target, vertical },
          ),
        )
        .toBe(true);
      await page
        .getByRole("button", { name: "前のページ", exact: true })
        .click();
      await expect
        .poll(() =>
          cssReader(page).evaluate(
            (root, { originalScroll, vertical }) => {
              const currentScroll = vertical
                ? -root.scrollLeft
                : root.scrollTop;
              return Math.abs(currentScroll - originalScroll);
            },
            { originalScroll, vertical },
          ),
        )
        .toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
