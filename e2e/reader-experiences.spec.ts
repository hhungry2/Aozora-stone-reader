import { expect, test, type Locator, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.clock.install({ time: new Date("2026-10-12T03:00:00Z") });
});

async function openReader(page: Page) {
  await page.goto("/#/read/000127");
  const rendered = page.getByTestId("reader-page");
  await expect(rendered.locator(".reader-leaf > svg")).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.clock.pauseAt(new Date("2026-10-12T03:05:00Z"));
  return rendered;
}

async function clickButton(page: Page, name: string) {
  // Freeze the animation at known frames without Playwright actionability
  // checks waiting on the same requestAnimationFrame that the test controls.
  await page
    .getByRole("button", { name, exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await page.clock.runFor(32);
}

async function setPageEffect(page: Page, enabled: boolean) {
  if (!(await page.locator(".reader-settings").isVisible()))
    await clickButton(page, "読書設定を開く");
  const toggle = page.getByRole("switch", {
    name: "文字がほどけるページ送り",
    exact: true,
  });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-checked")) !== String(enabled)) {
    await toggle.evaluate((button) => (button as HTMLButtonElement).click());
    await page.clock.runFor(32);
  }
  await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
  await clickButton(page, "読書設定を閉じる");
}

async function observePageEffects(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { observedPageEffects: number }).observedPageEffects =
      0;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (
            node instanceof Element &&
            (node.matches(".reader-page-turn-overlay") ||
              node.querySelector(".reader-page-turn-overlay"))
          )
            (window as unknown as { observedPageEffects: number })
              .observedPageEffects++;
    }).observe(document.querySelector(".reader-pages")!, {
      childList: true,
      subtree: true,
    });
  });
}

async function observedPageEffects(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { observedPageEffects: number })
        .observedPageEffects,
  );
}

async function toggleAnatomy(page: Page) {
  const toggle = page.getByRole("button", {
    name: "組版の解剖モード",
    exact: true,
  });
  const inSettings = !(await toggle.isVisible());
  if (inSettings) await clickButton(page, "読書設定を開く");
  await expect(toggle).toBeVisible();
  const rect = await toggle.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await clickButton(page, "組版の解剖モード");
  const pressed = await toggle.getAttribute("aria-pressed");
  if (inSettings) await clickButton(page, "読書設定を閉じる");
  return pressed;
}

async function settle(page: Page) {
  await page.clock.runFor(1200);
  // Pagination may yield to another task before committing the replacement
  // page. Pump its scheduled frames as well as the effect's shared clock.
  await expect
    .poll(async () => {
      await page.clock.runFor(64);
      return page
        .locator(
          ".reader-loading, .reader-page-turn-overlay, .reader-direction-overlay",
        )
        .count();
    })
    .toBe(0);
}

async function copyPage(rendered: Locator) {
  return rendered.evaluate(async (wrapper) => {
    const book = await (await fetch("data/books/000127.json")).json();
    const source = book.blocks
      .map((block: { text: string }) => block.text)
      .join("\n");
    const expected = source.slice(
      Number(wrapper.getAttribute("data-start")),
      Number(wrapper.getAttribute("data-end")),
    );
    const container = wrapper.querySelector(".reader-leaf")!;
    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const event = new ClipboardEvent("copy", {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);
    selection.removeAllRanges();
    return {
      expected,
      copied: event.clipboardData?.getData("text/plain"),
      prevented: event.defaultPrevented,
    };
  });
}

async function pointAtGlyph(glyph: Locator, type: "click" | "pointermove") {
  await glyph.evaluate((element, eventType) => {
    const rect = element.getBoundingClientRect();
    const options = {
      bubbles: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    };
    element.dispatchEvent(
      eventType === "click"
        ? new MouseEvent("click", options)
        : new PointerEvent("pointermove", { ...options, pointerType: "mouse" }),
    );
  }, type);
  await glyph.page().clock.runFor(32);
}

test("page turns dissolve successive columns in both directions while source copying stays exact", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const rendered = await openReader(page);
  await setPageEffect(page, true);
  await settle(page);
  await expect(page.getByText("言葉のつづきへ。", { exact: true })).toHaveCount(
    0,
  );

  for (const direction of ["tbRl", "lrTb"]) {
    if (direction === "lrTb") {
      await clickButton(page, "横書きに切り替え");
      await settle(page);
    }
    const nextStart = await rendered.getAttribute("data-end");
    await clickButton(page, "次のページ");
    await expect(rendered).toHaveAttribute("data-start", nextStart!);
    await expect(page.locator(".reader-pages")).toHaveAttribute(
      "data-page-transition",
      "running",
    );
    const overlay = page.locator(".reader-page-turn-overlay");
    const snapshot = await overlay.evaluate((element) => {
      const root = element.closest(".reader-pages")!;
      return {
        hidden: element.getAttribute("aria-hidden"),
        pointerEvents: getComputedStyle(element).pointerEvents,
        runs: element.querySelectorAll("[data-run]").length,
        svgCount: root.querySelectorAll("svg").length,
        leafSvgCount: root.querySelectorAll(".reader-leaf > svg").length,
        outgoingColumns: new Set(
          [
            ...element.querySelectorAll(
              '[data-page-turn-phase="outgoing"][data-column]',
            ),
          ].map((node) => node.getAttribute("data-column")),
        ).size,
        incomingColumns: new Set(
          [
            ...element.querySelectorAll(
              '[data-page-turn-phase="incoming"][data-column]',
            ),
          ].map((node) => node.getAttribute("data-column")),
        ).size,
      };
    });
    expect(snapshot).toMatchObject({
      hidden: "true",
      pointerEvents: "none",
      runs: 0,
    });
    expect(snapshot.svgCount).toBe(snapshot.leafSvgCount);
    expect(snapshot.outgoingColumns).toBeGreaterThan(1);
    expect(snapshot.incomingColumns).toBeGreaterThan(1);
    await page.clock.runFor(200);
    const outgoingOpacity = await overlay
      .locator('[data-page-turn-phase="outgoing"][data-column]')
      .evaluateAll((nodes) =>
        nodes.map((node) => Number(getComputedStyle(node).opacity)),
      );
    expect(Math.min(...outgoingOpacity)).toBeLessThan(
      Math.max(...outgoingOpacity),
    );
    const incomingOpacity = await overlay
      .locator('[data-page-turn-phase="incoming"][data-column]')
      .evaluateAll((nodes) =>
        nodes.map((node) => Number(getComputedStyle(node).opacity)),
      );
    expect(incomingOpacity.some((opacity) => opacity > 0 && opacity < 1)).toBe(
      true,
    );
    expect(
      await page
        .locator(".reader-page-wrap")
        .evaluate((element) => getComputedStyle(element).opacity),
    ).toBe("1");
    const during = await copyPage(rendered);
    expect(during.copied).toBe(during.expected);
    expect(during.prevented).toBe(true);
    await settle(page);
    await expect(page.locator(".reader-pages")).not.toHaveAttribute(
      "data-page-transition",
      "running",
    );
    await expect(rendered.locator("svg")).toHaveAttribute(
      "data-stone-direction",
      direction,
    );
    const after = await copyPage(rendered);
    expect(after.copied).toBe(after.expected);
  }
  expect(failures).toEqual([]);
});

test("reduced motion skips the page effect and repeated turns settle at the latest passage", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const rendered = await openReader(page);
  await setPageEffect(page, true);
  await settle(page);
  await observePageEffects(page);
  let start = await rendered.getAttribute("data-end");
  await clickButton(page, "次のページ");
  await expect(rendered).toHaveAttribute("data-start", start!);
  await settle(page);
  expect(await observedPageEffects(page)).toBe(0);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  const visitedStarts: string[] = [];
  for (let count = 0; count < 3; count++) {
    visitedStarts.push((await rendered.getAttribute("data-start"))!);
    start = await rendered.getAttribute("data-end");
    await clickButton(page, "次のページ");
    await expect(rendered).toHaveAttribute("data-start", start!);
    await expect(page.locator(".reader-page-turn-overlay")).toHaveCount(1);
    await page.clock.runFor(80);
  }
  await clickButton(page, "前のページ");
  await settle(page);
  await expect(rendered).toHaveAttribute("data-start", visitedStarts.at(-1)!);
  const copied = await copyPage(rendered);
  expect(copied.copied).toBe(copied.expected);
  expect(copied.prevented).toBe(true);
});

test.describe("page effect preferences", () => {
  // The page layout controls intentionally appear only on wide landscape
  // screens, including when this case runs in a mobile browser project.
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false });

  test("the effect defaults off, persists when enabled, cancels when disabled and keeps header layout controls", async ({
    page,
  }) => {
    const rendered = await openReader(page);
    await clickButton(page, "読書設定を開く");
    const toggle = page.getByRole("switch", {
      name: "文字がほどけるページ送り",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.locator(".reader-settings #page-layout")).toHaveCount(0);
    await expect(
      page
        .locator(".reader-settings")
        .getByRole("combobox", { name: "ページ表示", exact: true }),
    ).toHaveCount(0);
    await clickButton(page, "読書設定を閉じる");
    await settle(page);
    await observePageEffects(page);
    let nextStart = await rendered.getAttribute("data-end");
    await clickButton(page, "次のページ");
    await expect(rendered).toHaveAttribute("data-start", nextStart!);
    await settle(page);
    expect(await observedPageEffects(page)).toBe(0);

    await setPageEffect(page, true);
    await settle(page);
    await page.clock.resume();
    await page.reload();
    await expect(rendered.locator(".reader-leaf > svg")).toBeVisible();
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await page.clock.pauseAt(new Date("2026-10-12T03:10:00Z"));
    await clickButton(page, "読書設定を開く");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    // Keep the drawer open so disabling the preference is the only action
    // that can cancel the effect; opening it can resize and reflow the page.
    await settle(page);

    nextStart = await rendered.getAttribute("data-end");
    await clickButton(page, "次のページ");
    await expect(rendered).toHaveAttribute("data-start", nextStart!);
    await expect(page.locator(".reader-page-turn-overlay")).toHaveCount(1);
    await toggle.evaluate((button) => (button as HTMLButtonElement).click());
    await page.clock.runFor(32);
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    // Disabling the preference removes a running effect before its 820ms
    // duration has elapsed; it does not wait for the animation to finish.
    await expect(page.locator(".reader-page-turn-overlay")).toHaveCount(0);
    await expect(page.locator(".reader-pages")).not.toHaveAttribute(
      "data-page-transition",
      "running",
    );
    await clickButton(page, "読書設定を閉じる");
    await settle(page);

    const spread = page
      .locator(".reader-header")
      .getByRole("button", { name: "見開き表示に切り替え", exact: true });
    const single = page
      .locator(".reader-header")
      .getByRole("button", { name: "1ページ表示に切り替え", exact: true });
    await expect(spread).toBeVisible();
    await spread.evaluate((button) => (button as HTMLButtonElement).click());
    await settle(page);
    await expect(spread).toHaveAttribute("aria-pressed", "true");
    await expect(rendered).toHaveAttribute("data-layout", "spread");
    await expect(rendered.locator(".reader-leaf > svg")).toHaveCount(2);
    await single.evaluate((button) => (button as HTMLButtonElement).click());
    await settle(page);
    await expect(single).toHaveAttribute("aria-pressed", "true");
    await expect(rendered).toHaveAttribute("data-layout", "single");
    await expect(rendered.locator(".reader-leaf > svg")).toHaveCount(1);
  });
});

test("anatomy inspection exposes frames, punctuation widths and ruby allocation without breaking copy", async ({
  page,
}) => {
  const rendered = await openReader(page);
  expect(await toggleAnatomy(page)).toBe("true");
  const panel = page.locator(".reader-anatomy-panel");
  await expect(page.locator(".reader-pages")).toHaveAttribute(
    "data-anatomy",
    "true",
  );
  await expect(panel).toBeVisible();
  const body = rendered.locator('[data-run][data-source^="body:"]');
  const rubyParent = body.filter({ hasText: /^下$/u }).first();
  await pointAtGlyph(rubyParent, "click");
  await expect(panel).toHaveAttribute(
    "data-source",
    (await rubyParent.getAttribute("data-source"))!,
  );
  for (const label of ["文字枠", "送り幅", "ルビ", "禁則"])
    await expect(panel).toContainText(label);
  await expect(panel).toContainText("げにん");
  await expect(rendered.locator(".reader-anatomy-overlay")).toHaveCount(1);
  const punctuation = body.filter({ hasText: /^。$/u }).first();
  await pointAtGlyph(punctuation, "pointermove");
  await expect(panel).toHaveAttribute(
    "data-source",
    (await punctuation.getAttribute("data-source"))!,
  );
  await expect(panel).toContainText("。");
  const copied = await copyPage(rendered);
  expect(copied.copied).toBe(copied.expected);
  expect(copied.prevented).toBe(true);
  expect(await toggleAnatomy(page)).toBe("false");
  await expect(panel).toHaveCount(0);
  await expect(rendered.locator(".reader-anatomy-overlay")).toHaveCount(0);
});

test("anatomy keyboard controls inspect adjacent glyphs and reflow clears stale selection", async ({
  page,
}) => {
  const rendered = await openReader(page);
  await toggleAnatomy(page);
  const panel = page.locator(".reader-anatomy-panel");
  await clickButton(page, "最初の文字を調べる");
  const first = await panel.getAttribute("data-source");
  expect(first).toMatch(/^body:\d+$/u);
  await page.getByRole("button", { name: "次の文字", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.clock.runFor(32);
  await expect(panel).not.toHaveAttribute("data-source", first!);
  await page.getByRole("button", { name: "前の文字", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.clock.runFor(32);
  await expect(panel).toHaveAttribute("data-source", first!);
  await clickButton(page, "横書きに切り替え");
  await settle(page);
  await expect(panel).not.toHaveAttribute("data-source", /.+/u);
  await clickButton(page, "最初の文字を調べる");
  await expect(panel).toHaveAttribute("data-source", /^body:\d+$/u);
  const nextStart = await rendered.getAttribute("data-end");
  await clickButton(page, "次のページ");
  await settle(page);
  await expect(rendered).toHaveAttribute("data-start", nextStart!);
  await expect(panel).not.toHaveAttribute("data-source", /.+/u);
  await clickButton(page, "最初の文字を調べる");
  const nextSource = await panel.getAttribute("data-source");
  expect(Number(nextSource!.split(":")[1])).toBeGreaterThanOrEqual(
    Number(nextStart),
  );
});

test.describe("anatomy on narrow screens", () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("the panel and mode button fit and touching panel controls preserves the page", async ({
    page,
  }) => {
    const rendered = await openReader(page);
    await toggleAnatomy(page);
    await clickButton(page, "最初の文字を調べる");
    const panel = page.locator(".reader-anatomy-panel");
    const start = await rendered.getAttribute("data-start");
    for (const locator of [
      panel,
      page.getByRole("button", { name: "読書設定を開く", exact: true }),
    ]) {
      const rect = await locator.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(320);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(700);
    }
    await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      for (const type of ["pointerdown", "pointerup"])
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerType: "touch",
            clientX: rect.x + (type === "pointerdown" ? 5 : 95),
            clientY: rect.y + 5,
          }),
        );
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 120,
        }),
      );
      element.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: rect.x + 5,
          clientY: rect.y + 5,
        }),
      );
    });
    await page.clock.runFor(64);
    await expect(rendered).toHaveAttribute("data-start", start!);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await toggleAnatomy(page);
    await expect(panel).toHaveCount(0);
  });
});
