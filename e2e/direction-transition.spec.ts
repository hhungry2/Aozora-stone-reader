import { expect, test, type Locator, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Optional font downloads must not determine when a transition can start.
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.clock.install({ time: new Date("2026-10-12T03:00:00Z") });
});

async function openReader(page: Page) {
  await page.goto("/#/read/000127");
  const rendered = page.getByTestId("reader-page");
  await expect(rendered.locator("svg")).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.clock.pauseAt(new Date("2026-10-12T03:05:00Z"));
  return rendered;
}

async function expectSettled(page: Page) {
  await page.clock.runFor(1000);
  await expect(page.locator(".reader-pages")).not.toHaveAttribute(
    "data-direction-transition",
    "running",
  );
  await expect(page.locator(".reader-direction-overlay")).toHaveCount(0);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
}

async function clickButton(page: Page, name: string) {
  // Clock control lets every browser inspect the same animation frames. DOM
  // activation avoids actionability checks waiting for a frozen animation frame.
  await page
    .getByRole("button", { name, exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await page.clock.runFor(32);
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
    const svgs = wrapper.querySelectorAll(".reader-leaf > svg");
    const container =
      svgs.length === 1
        ? svgs[0].parentElement!
        : wrapper.querySelector(".reader-pages")!;
    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent("copy", {
      clipboardData,
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

async function observeTransitions(rendered: Locator) {
  await rendered.evaluate((wrapper) => {
    const state = window as unknown as {
      directionTransitions: string[];
      directionTransitionObserver?: MutationObserver;
    };
    state.directionTransitionObserver?.disconnect();
    state.directionTransitions = [];
    state.directionTransitionObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.type === "attributes" &&
          record.attributeName === "data-direction-transition" &&
          (record.oldValue === "running" ||
            (record.target as Element).getAttribute(record.attributeName) ===
              "running")
        )
          state.directionTransitions.push("running");
        for (const node of record.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches(".reader-direction-overlay") ||
              node.querySelector(".reader-direction-overlay"))
          )
            state.directionTransitions.push("overlay");
        }
      }
    });
    state.directionTransitionObserver.observe(wrapper, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["data-direction-transition"],
    });
  });
}

async function expectNoObservedTransitions(page: Page) {
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { directionTransitions: string[] })
          .directionTransitions,
    ),
  ).toEqual([]);
}

async function captureRunningTransition(page: Page) {
  const before = await page.evaluate(() => {
    const root = document.querySelector(".reader-pages")!;
    const overlay = root.querySelector(".reader-direction-overlay")!;
    const nodes = [...overlay.querySelectorAll("[data-source]")];
    return {
      leafSvgCount: root.querySelectorAll(".reader-leaf > svg").length,
      svgCount: root.querySelectorAll("svg").length,
      direction: root
        .querySelector("svg")!
        .getAttribute("data-stone-direction"),
      hidden: overlay.getAttribute("aria-hidden"),
      pointerEvents: getComputedStyle(overlay).pointerEvents,
      runCount: overlay.querySelectorAll("[data-run]").length,
      glyphCount: nodes.length,
      positions: nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          source: node.getAttribute("data-source"),
          x: rect.x,
          y: rect.y,
        };
      }),
    };
  });
  await page.clock.runFor(120);
  const moved = await page.evaluate(
    (positions) =>
      [
        ...document.querySelectorAll(".reader-direction-overlay [data-source]"),
      ].some((node) => {
        const old = positions.find(
          (value) => value.source === node.getAttribute("data-source"),
        );
        const rect = node.getBoundingClientRect();
        return old && Math.hypot(rect.x - old.x, rect.y - old.y) > 2;
      }),
    before.positions,
  );
  return { ...before, moved };
}

test("direction changes move the same source glyphs at the saved passage and preserve copying", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const rendered = await openReader(page);
  const end = await rendered.getAttribute("data-end");
  await clickButton(page, "次のページ");
  await expect(rendered).toHaveAttribute("data-start", end!);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  const block = await rendered.getAttribute("data-block");
  const offset = await rendered.getAttribute("data-offset");

  for (const [direction, label] of [
    ["lrTb", "横書きに切り替え"],
    ["tbRl", "縦書きに切り替え"],
  ]) {
    await clickButton(page, label);
    await expect(page.locator(".reader-pages")).toHaveAttribute(
      "data-direction-transition",
      "running",
    );
    const running = await captureRunningTransition(page);
    expect(running).toMatchObject({
      leafSvgCount: 1,
      svgCount: 1,
      direction,
      hidden: "true",
      pointerEvents: "none",
      runCount: 0,
      moved: true,
    });
    expect(running.glyphCount).toBeGreaterThan(10);
    await expectSettled(page);
    await expect(rendered).toHaveAttribute("data-block", block!);
    await expect(rendered).toHaveAttribute("data-offset", offset!);
    const sourceMatches = await rendered.evaluate(async (wrapper) => {
      const book = await (await fetch("data/books/000127.json")).json();
      const source = book.blocks
        .map((block: { text: string }) => block.text)
        .join("\n");
      return [...wrapper.querySelectorAll("[data-run]")].every((node) => {
        const position = node.getAttribute("data-source")?.match(/(\d+)$/u);
        if (!position) return false;
        const text = node.textContent!;
        return (
          source.slice(
            Number(position[1]),
            Number(position[1]) + text.length,
          ) === text
        );
      });
    });
    expect(sourceMatches).toBe(true);
    const copied = await copyPage(rendered);
    expect(copied.copied).toBe(copied.expected);
    expect(copied.prevented).toBe(true);
  }

  // Ordinary pagination and typography edits still use their normal reflow.
  await observeTransitions(rendered);
  const nextStart = await rendered.getAttribute("data-end");
  await clickButton(page, "次のページ");
  await expect(rendered).toHaveAttribute("data-start", nextStart!);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await clickButton(page, "フォントサイズを調整");
  await page.getByLabel("フォントサイズ", { exact: true }).fill("22");
  await clickButton(page, "調整を閉じる");
  await expectSettled(page);
  await expectNoObservedTransitions(page);
  expect(failures).toEqual([]);
});

test("reduced motion switches both directions without creating an animation overlay", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const rendered = await openReader(page);
  await observeTransitions(rendered);
  for (const [direction, label] of [
    ["lrTb", "横書きに切り替え"],
    ["tbRl", "縦書きに切り替え"],
  ]) {
    await clickButton(page, label);
    await expect(rendered.locator("svg")).toHaveAttribute(
      "data-stone-direction",
      direction,
    );
    await expectSettled(page);
  }
  await expectNoObservedTransitions(page);
  const copied = await copyPage(rendered);
  expect(copied.copied).toBe(copied.expected);
  expect(copied.prevented).toBe(true);
});

test("Latin letters turn gradually while tate-chu-yoko and spaced ruby keep their source identities", async ({
  page,
}) => {
  const text = "English 12月𠮷か\u3099漢字。";
  const rubyStart = text.indexOf("漢字");
  await page.route("**/data/books/000127.json", async (route) => {
    const response = await route.fetch();
    const book = await response.json();
    book.blocks = [
      {
        ...book.blocks[0],
        text,
        rubies: [{ start: rubyStart, end: rubyStart + 2, reading: "かん じ" }],
        emphasis: [],
        inlineImages: [],
      },
    ];
    book.toc = [];
    await route.fulfill({ response, json: book });
  });
  const rendered = await openReader(page);
  const letter = rendered.locator('[data-run][data-source="body:0"]');
  await expect(letter).toHaveAttribute("rotate", "90");
  const number = rendered.locator(
    `[data-run][data-source="body:${text.indexOf("1")}"]`,
  );
  expect(await number.getAttribute("rotate")).toBeNull();
  const lastRuby = rendered.locator(
    `.reader-rubies [data-source="ruby:${rubyStart}:3"]`,
  );
  await expect(lastRuby).toHaveText("じ");
  const beforeSources = await rendered
    .locator("[data-reader-content] [data-source]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-source")).sort(),
    );
  await clickButton(page, "横書きに切り替え");
  await page.clock.runFor(120);
  const degrees = await page.evaluate(() => {
    const overlayLetter = document.querySelector(
      '.reader-direction-overlay [data-source="body:0"]',
    );
    const value = overlayLetter
      ?.getAttribute("transform")
      ?.match(/rotate\(([-\d.]+)\)/u);
    if (!value) return false;
    const degrees = Number(value[1]);
    return degrees > 0 && degrees < 90 ? degrees : false;
  });
  expect(degrees).toBeGreaterThan(0);
  expect(degrees).toBeLessThan(90);
  await expectSettled(page);
  expect(await letter.getAttribute("rotate")).toBeNull();
  expect(await number.getAttribute("rotate")).toBeNull();
  await expect(lastRuby).toHaveText("じ");
  expect(
    await rendered
      .locator("[data-reader-content] [data-source]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-source")).sort(),
      ),
  ).toEqual(beforeSources);
  const copied = await copyPage(rendered);
  expect(copied.copied).toBe(text);
  expect(copied.prevented).toBe(true);
});

test("navigation, resize, and a new reduced-motion preference cancel a running transition", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const rendered = await openReader(page);
  const switchAndWait = async (label: string) => {
    await clickButton(page, label);
    await expect(page.locator(".reader-pages")).toHaveAttribute(
      "data-direction-transition",
      "running",
    );
  };
  const expectCancelled = async () => {
    await expect(page.locator(".reader-pages")).not.toHaveAttribute(
      "data-direction-transition",
      "running",
    );
    await expect(page.locator(".reader-direction-overlay")).toHaveCount(0);
  };
  await switchAndWait("横書きに切り替え");
  const nextStart = await rendered.getAttribute("data-end");
  await clickButton(page, "次のページ");
  await expectCancelled();
  await expect(rendered).toHaveAttribute("data-start", nextStart!);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  const block = await rendered.getAttribute("data-block");
  const offset = await rendered.getAttribute("data-offset");

  await switchAndWait("縦書きに切り替え");
  const viewport = page.viewportSize()!;
  const size = { width: viewport.width - 40, height: viewport.height };
  // Windows Firefox can deliver the resize event before acknowledging the command.
  await Promise.race([
    page.setViewportSize(size),
    page.waitForFunction(
      ({ width, height }) =>
        document.documentElement.clientWidth === width &&
        document.documentElement.clientHeight === height,
      size,
    ),
  ]);
  await page.clock.runFor(32);
  await expectCancelled();
  // ResizeObserver may schedule the replacement page on a later frame in WebKit.
  // Cancellation is already verified before allowing that reflow to complete.
  await page.clock.runFor(1000);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(rendered).toHaveAttribute("data-block", block!);
  await expect(rendered).toHaveAttribute("data-offset", offset!);

  await switchAndWait("横書きに切り替え");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.runFor(32);
  await expectCancelled();
  await expect(rendered.locator("svg")).toHaveAttribute(
    "data-stone-direction",
    "lrTb",
  );
  const copied = await copyPage(rendered);
  expect(copied.copied).toBe(copied.expected);
  expect(copied.prevented).toBe(true);
  expect(failures).toEqual([]);
});

test.describe("spread transitions", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false });

  test("reversing a running spread transition settles at the requested direction", async ({
    page,
  }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    const rendered = await openReader(page);
    await clickButton(page, "見開き表示に切り替え");
    await expect(rendered).toHaveAttribute("data-layout", "spread");
    await expect(rendered.locator("svg")).toHaveCount(2);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    const originalEnd = await rendered.getAttribute("data-end");
    await clickButton(page, "横書きに切り替え");
    await expect(page.locator(".reader-pages")).toHaveAttribute(
      "data-direction-transition",
      "running",
    );
    await expect(rendered.locator(".reader-leaf > svg")).toHaveCount(2);
    await expect(rendered.locator("svg")).toHaveCount(2);
    await clickButton(page, "縦書きに切り替え");
    await expectSettled(page);
    await expect(
      rendered.locator('svg[data-stone-direction="tbRl"]'),
    ).toHaveCount(2);
    await expect(rendered).toHaveAttribute("data-start", "0");
    await expect(rendered).toHaveAttribute("data-end", originalEnd!);
    const leaves = page.getByTestId("reader-leaf");
    expect(await leaves.nth(1).getAttribute("data-start")).toBe(
      await leaves.nth(0).getAttribute("data-end"),
    );
    const copied = await copyPage(rendered);
    expect(copied.copied).toBe(copied.expected);
    expect(copied.prevented).toBe(true);
    expect(failures).toEqual([]);
  });
});
