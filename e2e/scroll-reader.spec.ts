import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { defaultSettings, type Book, type ReaderSettings } from "../src/types";

const rendered = (page: Page) => page.getByTestId("reader-page");
const scrollReader = (page: Page) => page.getByTestId("scroll-reader");
const settingsKey = "aozora-stone-reader:v1:settings";
const recordKey = "aozora-stone-reader:v1:record:000127";

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function seedSettings(page: Page, settings: Partial<ReaderSettings>) {
  await page.addInitScript(
    ({ preferences, key }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(preferences));
    },
    {
      preferences: { ...defaultSettings, ...settings, settingsVersion: 2 },
      key: settingsKey,
    },
  );
}

async function ready(page: Page, mode: "pages" | "scroll") {
  await expect(
    rendered(page).locator(".reader-leaf > svg").first(),
  ).toBeAttached();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: mode === "scroll" ? "スクロール表示" : "ページ表示",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  if (mode === "scroll") {
    await expect(scrollReader(page)).toBeVisible();
    await expect(rendered(page)).toHaveAttribute("data-layout", "scroll");
  } else {
    await expect(scrollReader(page)).toHaveCount(0);
  }
}

async function chooseMode(page: Page, mode: "pages" | "scroll") {
  await page
    .getByRole("button", {
      name: mode === "scroll" ? "スクロール表示" : "ページ表示",
      exact: true,
    })
    .click();
  await ready(page, mode);
}

async function currentStart(page: Page) {
  return Number(await rendered(page).getAttribute("data-start"));
}

async function currentAnchor(page: Page) {
  return {
    blockId: await rendered(page).getAttribute("data-block"),
    offset: Number(await rendered(page).getAttribute("data-offset")),
  };
}

async function savedAnchor(page: Page) {
  return page.evaluate((key) => {
    const record = JSON.parse(localStorage.getItem(key) ?? "null");
    return record
      ? { blockId: record.anchor.blockId, offset: record.anchor.offset }
      : null;
  }, recordKey);
}

async function moveWithinDocument(page: Page, direction: "tbRl" | "lrTb") {
  const before = await currentStart(page);
  await scrollReader(page).evaluate((element, writingDirection) => {
    element.scrollBy({
      left: writingDirection === "tbRl" ? -element.clientWidth * 0.8 : 0,
      top: writingDirection === "lrTb" ? element.clientHeight * 0.8 : 0,
      behavior: "instant",
    });
  }, direction);
  await expect.poll(() => currentStart(page)).toBeGreaterThan(before);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
}

async function visibleSource(page: Page) {
  return rendered(page).evaluate((wrapper) => {
    const viewport = wrapper
      .closest(".reader-viewport")!
      .getBoundingClientRect();
    const vertical = wrapper
      .closest(".reader-shell")!
      .classList.contains("vertical");
    const candidates = [
      ...wrapper.querySelectorAll<SVGTSpanElement>("[data-run][data-source]"),
    ]
      .filter(
        (glyph) =>
          glyph.dataset.source?.startsWith("body:") &&
          glyph.textContent?.trim(),
      )
      .map((glyph) => ({ glyph, rect: glyph.getBoundingClientRect() }))
      .filter(
        ({ rect }) =>
          rect.left >= viewport.left - 1 &&
          rect.right <= viewport.right + 1 &&
          rect.top >= viewport.top - 1 &&
          rect.bottom <= viewport.bottom + 1,
      )
      .sort((a, b) =>
        vertical
          ? b.rect.right - a.rect.right || a.rect.top - b.rect.top
          : a.rect.top - b.rect.top || a.rect.left - b.rect.left,
      );
    if (!candidates.length) throw new Error("No visible source glyph");
    return candidates[0].glyph.dataset.source!;
  });
}

async function expectSourceVisible(page: Page, source: string) {
  await expect
    .poll(() =>
      rendered(page).evaluate((wrapper, identity) => {
        const viewport = wrapper
          .closest(".reader-viewport")!
          .getBoundingClientRect();
        return [
          ...wrapper.querySelectorAll<SVGTSpanElement>(
            "[data-run][data-source]",
          ),
        ]
          .filter((glyph) => glyph.dataset.source === identity)
          .some((glyph) => {
            const rect = glyph.getBoundingClientRect();
            const vertical = wrapper
              .closest(".reader-shell")!
              .classList.contains("vertical");
            const inlineExtent = vertical ? viewport.height : viewport.width;
            const fontSize = Number.parseFloat(
              getComputedStyle(glyph).fontSize,
            );
            const sourceDistance =
              Number(identity.slice(5)) -
              Number(wrapper.getAttribute("data-start"));
            return (
              // Merely finding the old glyph at the far edge can mask a reset
              // to the beginning of a short work. The leading source must also
              // remain within two reflowed lines of the former leading glyph.
              sourceDistance >= 0 &&
              sourceDistance <= Math.ceil(inlineExtent / fontSize) * 2 + 16 &&
              rect.right > viewport.left &&
              rect.left < viewport.right &&
              rect.bottom > viewport.top &&
              rect.top < viewport.bottom
            );
          });
      }, source),
    )
    .toBe(true);
}

async function expectBoundedDocument(page: Page) {
  await expect
    .poll(async () => {
      const mounted = await scrollReader(page)
        .locator(".reader-leaf > svg")
        .count();
      return mounted > 0 && mounted <= 7;
    })
    .toBe(true);
  expect(
    Number(await scrollReader(page).getAttribute("data-mounted-chunks")),
  ).toBeLessThanOrEqual(7);
  expect(
    Number(await scrollReader(page).getAttribute("data-cache-size")),
  ).toBeLessThanOrEqual(7);
  expect(await scrollReader(page).locator("[data-run]").count()).toBeLessThan(
    20_000,
  );
}

test("SVG scroll mode persists and uses continuous native scroll in both writing directions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/read/000127");
  await ready(page, "pages");
  await chooseMode(page, "scroll");

  for (const direction of ["tbRl", "lrTb"] as const) {
    if (direction === "lrTb") {
      await page
        .getByRole("button", { name: "横書きに切り替え", exact: true })
        .click();
      await ready(page, "scroll");
    }
    await expect(
      scrollReader(page).locator(".reader-leaf > svg").first(),
    ).toHaveAttribute("data-stone-direction", direction);
    const dimensions = await scrollReader(page).evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      touchAction: getComputedStyle(element).touchAction,
    }));
    expect(dimensions.touchAction).not.toBe("none");
    if (direction === "tbRl")
      expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.width);
    else expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.height);
    await moveWithinDocument(page, direction);
    const coordinate = await scrollReader(page).evaluate(
      (element, writingDirection) =>
        writingDirection === "tbRl" ? element.scrollLeft : element.scrollTop,
      direction,
    );
    expect(direction === "tbRl" ? -coordinate : coordinate).toBeGreaterThan(0);
    await expectBoundedDocument(page);
    await expect
      .poll(() => savedAnchor(page))
      .toEqual(await currentAnchor(page));

    // A touch drag belongs to the native scroller. The parent's page swipe
    // recognizer must not turn the page merely from these pointer coordinates.
    const beforeTouch = await currentStart(page);
    await scrollReader(page).evaluate((element) => {
      for (const [type, x] of [
        ["pointerdown", 80],
        ["pointerup", 280],
      ] as const)
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerType: "touch",
            pointerId: 1,
            clientX: x,
            clientY: 200,
          }),
        );
    });
    await expect(rendered(page)).toHaveAttribute(
      "data-start",
      String(beforeTouch),
    );
    const prevented = await scrollReader(page).evaluate((element) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 24,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    if (direction === "lrTb") expect(prevented).toBe(false);
  }

  const source = await visibleSource(page);
  await page.reload();
  await ready(page, "scroll");
  await expectSourceVisible(page, source);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).viewMode,
        settingsKey,
      ),
    )
    .toBe("scroll");
  expect(errors).toEqual([]);
});

test("mode switches, direction changes, font reflow and bookmarks preserve the visible passage", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/read/000127");
  await ready(page, "pages");
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect(rendered(page)).not.toHaveAttribute("data-start", "0");
  const pageSource = await visibleSource(page);
  await chooseMode(page, "scroll");
  await expectSourceVisible(page, pageSource);
  await moveWithinDocument(page, "tbRl");
  const scrollSource = await visibleSource(page);
  await chooseMode(page, "pages");
  await expectSourceVisible(page, scrollSource);
  await chooseMode(page, "scroll");
  await expectSourceVisible(page, scrollSource);

  await page
    .getByRole("button", { name: "横書きに切り替え", exact: true })
    .click();
  await ready(page, "scroll");
  await expectSourceVisible(page, scrollSource);
  await page
    .getByRole("button", { name: "フォントサイズを調整", exact: true })
    .click();
  await page.getByLabel("フォントサイズ", { exact: true }).fill("28");
  await page.getByRole("button", { name: "調整を閉じる", exact: true }).click();
  await ready(page, "scroll");
  await expectSourceVisible(page, scrollSource);

  const bookmarkAnchor = await currentAnchor(page);
  const bookmarkSource = await visibleSource(page);
  await page
    .getByRole("button", { name: "このページにしおりを挟む", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const record = JSON.parse(localStorage.getItem(key)!);
        return record.bookmarks.map(
          (bookmark: { anchor: { blockId: string; offset: number } }) => ({
            blockId: bookmark.anchor.blockId,
            offset: bookmark.anchor.offset,
          }),
        );
      }, recordKey),
    )
    .toEqual([bookmarkAnchor]);
  await moveWithinDocument(page, "lrTb");
  await page
    .getByRole("button", { name: "しおり一覧を開く", exact: true })
    .click();
  await page.locator(".bookmark-jump").click();
  await ready(page, "scroll");
  await expectSourceVisible(page, bookmarkSource);
  expect(errors).toEqual([]);
});

test("leaving immediately after a native scroll saves the source before its animation frame", async ({
  page,
}) => {
  await seedSettings(page, { viewMode: "scroll", direction: "lrTb" });
  await page.goto("/#/read/000127");
  await ready(page, "scroll");
  const saved = await scrollReader(page).evaluate((element, key) => {
    element.scrollBy({ top: element.clientHeight * 0.8, behavior: "instant" });
    // A tab close can precede both the scroll animation frame and the 120 ms
    // progress throttle. Dispatch in the same task to exercise that boundary.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    const record = JSON.parse(localStorage.getItem(key)!);
    return {
      blockId: record.anchor.blockId as string,
      offset: record.anchor.offset as number,
      progress: record.progress as number,
    };
  }, recordKey);
  expect(saved.progress).toBeGreaterThan(0);
  expect(saved.blockId !== "b00001" || saved.offset > 0).toBe(true);
  const source = await visibleSource(page);
  await page.reload();
  await ready(page, "scroll");
  await expectSourceVisible(page, source);
  await expectBoundedDocument(page);
});

test("a million-character book mounts only nearby SVG chunks and jumps directly to distant chapters", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const original = JSON.parse(
    readFileSync("public/data/books/000127.json", "utf8"),
  ) as Book;
  const paragraph = original.blocks[2];
  const blocks = Array.from({ length: 3500 }, (_, index) => ({
    ...paragraph,
    id: `long-${String(index).padStart(5, "0")}`,
  }));
  const longBook: Book = {
    ...original,
    characterCount: blocks.reduce(
      (count, block) => count + block.text.length,
      0,
    ),
    blocks,
    toc: [0, 1750, 3400].map((index) => ({
      title: `章 ${index}`,
      blockId: blocks[index].id,
      level: 1,
    })),
  };
  expect(longBook.characterCount).toBeGreaterThan(1_000_000);
  await page.route("**/data/books/000127.json*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(longBook),
    }),
  );
  // A former all-page preparation preference must not lay out the whole book
  // behind the continuously scrolling reader.
  await seedSettings(page, {
    viewMode: "scroll",
    paginationMode: "all",
    direction: "lrTb",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/read/000127");
  await ready(page, "scroll");
  await expectBoundedDocument(page);
  await expect(page.getByTestId("pagination-preload")).toHaveCount(0);
  await page.getByRole("button", { name: "目次を開く", exact: true }).click();
  await page.locator(".toc-list > button").last().click();
  await ready(page, "scroll");
  await expect(rendered(page)).toHaveAttribute("data-block", blocks[3400].id);
  await expectBoundedDocument(page);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).progress,
        recordKey,
      ),
    )
    .toBeGreaterThan(0.9);
  for (let index = 0; index < 5; index++) {
    await moveWithinDocument(page, "lrTb");
    await expectBoundedDocument(page);
  }
  await page
    .getByRole("button", { name: "縦書きに切り替え", exact: true })
    .click();
  await ready(page, "scroll");
  await expectBoundedDocument(page);
  await moveWithinDocument(page, "tbRl");
  await expectBoundedDocument(page);
  await page.getByRole("button", { name: "目次を開く", exact: true }).click();
  await page.locator(".toc-list > button").first().click();
  await ready(page, "scroll");
  await expect(rendered(page)).toHaveAttribute("data-start", "0");
  await expectBoundedDocument(page);
  expect(errors).toEqual([]);
});

test("virtual SVG chunks retain source copying and glyph anatomy after scrolling", async ({
  page,
}) => {
  await seedSettings(page, { viewMode: "scroll", direction: "lrTb" });
  await page.goto("/#/read/000127");
  await ready(page, "scroll");
  await moveWithinDocument(page, "lrTb");
  const copied = await scrollReader(page)
    .locator(".reader-leaf")
    .first()
    .evaluate(async (leaf) => {
      const book = await (await fetch("data/books/000127.json")).json();
      const source = book.blocks
        .map((block: { text: string }) => block.text)
        .join("\n");
      const range = document.createRange();
      range.selectNodeContents(leaf);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const event = new ClipboardEvent("copy", {
        clipboardData: new DataTransfer(),
        bubbles: true,
        cancelable: true,
      });
      leaf.dispatchEvent(event);
      selection.removeAllRanges();
      return {
        expected: source.slice(
          Number(leaf.getAttribute("data-start")),
          Number(leaf.getAttribute("data-end")),
        ),
        actual: event.clipboardData?.getData("text/plain"),
        prevented: event.defaultPrevented,
      };
    });
  expect(copied.actual).toBe(copied.expected);
  expect(copied.prevented).toBe(true);

  // Put the viewport across a real chunk boundary so both neighboring SVGs
  // are mounted on narrow screens as well as on a desktop.
  await scrollReader(page).evaluate((element) => {
    const first = element.querySelector<HTMLElement>(".scroll-reader-chunk")!;
    element.scrollTo({
      top: first.offsetTop + first.offsetHeight - element.clientHeight * 0.5,
      behavior: "instant",
    });
  });
  await expect
    .poll(() => scrollReader(page).locator(".reader-leaf").count())
    .toBeGreaterThanOrEqual(2);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  const acrossChunks = await scrollReader(page).evaluate(async (element) => {
    const book = await (await fetch("data/books/000127.json")).json();
    const source = book.blocks
      .map((block: { text: string }) => block.text)
      .join("\n");
    const leaves = element.querySelectorAll<HTMLElement>(".reader-leaf");
    const range = document.createRange();
    range.setStartBefore(leaves[0]);
    range.setEndAfter(leaves[1]);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const event = new ClipboardEvent("copy", {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    selection.removeAllRanges();
    return {
      expected: source.slice(
        Number(leaves[0].dataset.start),
        Number(leaves[1].dataset.end),
      ),
      actual: event.clipboardData?.getData("text/plain"),
      prevented: event.defaultPrevented,
    };
  });
  // A complete SVG chunk includes its trailing paragraph separator even though
  // that newline has no visible glyph node for the copy handler to collect.
  expect(acrossChunks.expected.endsWith("\n")).toBe(true);
  expect(acrossChunks.actual).toBe(acrossChunks.expected);
  expect(acrossChunks.prevented).toBe(true);

  const toggle = page.getByRole("button", {
    name: "組版の解剖モード",
    exact: true,
  });
  const inSettings = !(await toggle.isVisible());
  if (inSettings)
    await page
      .getByRole("button", { name: "読書設定を開く", exact: true })
      .click();
  await toggle.click();
  if (inSettings)
    await page
      .getByRole("button", { name: "読書設定を閉じる", exact: true })
      .click();
  await ready(page, "scroll");
  const source = await visibleSource(page);
  await scrollReader(page)
    .locator(`[data-run][data-source="${source}"]`)
    .click();
  const panel = page.getByRole("region", { name: "組版の解剖", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-source", source);
  await expect(panel).toContainText("文字枠");
  await expect(panel).toContainText("送り幅");
  await expectBoundedDocument(page);
});
