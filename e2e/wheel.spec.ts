import { expect, test, type Page } from "@playwright/test";

// Playwright's mobile WebKit backend cannot send wheel input. Exercise desktop
// mouse input while retaining each project's screen size and touch capability.
test.use({ isMobile: false });

async function openReader(page: Page) {
  await page.goto("/#/read/000127");
  const rendered = page.getByTestId("reader-page");
  await expect(rendered.locator("svg")).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(rendered).toHaveAttribute("data-start", "0");
  return rendered;
}

async function pointAtText(page: Page) {
  const bounds = await page.getByTestId("reader-viewport").boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2,
  );
}

test("the mouse wheel turns one page forward or backward in either writing direction", async ({
  page,
}) => {
  const rendered = await openReader(page);
  for (const direction of ["tbRl", "lrTb"]) {
    if (direction === "lrTb") {
      await page.getByRole("button", { name: "横書きに切り替え" }).click();
      await expect(page.locator(".reader-loading")).toHaveCount(0);
    }
    await expect(rendered.locator("svg")).toHaveAttribute(
      "data-stone-direction",
      direction,
    );
    await expect(rendered).toHaveAttribute("data-start", "0");
    await pointAtText(page);
    await page.mouse.wheel(0, -120);
    await expect(rendered).toHaveAttribute("data-start", "0");

    // Let the previous gesture end before starting a separate wheel gesture.
    await page.waitForTimeout(350);
    const firstPageEnd = await rendered.getAttribute("data-end");
    await page.mouse.wheel(0, 120);
    await expect(rendered).toHaveAttribute("data-start", firstPageEnd!);
    await expect(page.locator(".reader-loading")).toHaveCount(0);

    await page.waitForTimeout(350);
    await page.mouse.wheel(0, -120);
    await expect(rendered).toHaveAttribute("data-start", "0");
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await page.waitForTimeout(350);
  }
});

test("small wheel deltas accumulate, a burst advances once, and zoom shortcuts stay available", async ({
  page,
}) => {
  const rendered = await openReader(page);
  const viewport = page.getByTestId("reader-viewport");
  const firstPageEnd = await rendered.getAttribute("data-end");

  const zoomCancelled = await viewport.evaluate((element) => {
    return [{ ctrlKey: true }, { metaKey: true }].map((modifiers) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 120,
        ...modifiers,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
  });
  expect(zoomCancelled).toEqual([false, false]);
  await expect(rendered).toHaveAttribute("data-start", "0");

  const startBeforeThreshold = await viewport.evaluate((element) => {
    for (const deltaY of [10, 10]) {
      element.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY }),
      );
    }
    const start = element
      .querySelector('[data-testid="reader-page"]')
      ?.getAttribute("data-start");
    for (const deltaY of [20, 120, 120, 120, 120, 120, 120]) {
      element.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY }),
      );
    }
    return start;
  });
  expect(startBeforeThreshold).toBe("0");
  await expect(rendered).toHaveAttribute("data-start", firstPageEnd!);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  // A wheel burst must not queue additional page turns after pagination finishes.
  await page.waitForTimeout(350);
  await expect(rendered).toHaveAttribute("data-start", firstPageEnd!);

  await viewport.evaluate((element) => {
    element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -1,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
      }),
    );
  });
  await expect(rendered).toHaveAttribute("data-start", "0");
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page.waitForTimeout(350);
  await viewport.evaluate((element) => {
    element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 1,
        deltaMode: WheelEvent.DOM_DELTA_PAGE,
      }),
    );
  });
  await expect(rendered).toHaveAttribute("data-start", firstPageEnd!);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
});

test.describe("scrollable reader settings", () => {
  test.use({ viewport: { width: 390, height: 480 } });
  test("scrolling the settings dialog scrolls its contents and preserves the reading page", async ({
    page,
  }) => {
    const rendered = await openReader(page);
    const firstPageEnd = await rendered.getAttribute("data-end");
    await page.getByRole("button", { name: "読書設定を開く" }).click();
    const dialog = page.getByRole("dialog", { name: "読書の設定" });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() =>
        dialog.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(
      bounds!.x + bounds!.width / 2,
      bounds!.y + bounds!.height / 2,
    );
    await page.mouse.wheel(0, 240);
    await expect
      .poll(() => dialog.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(rendered).toHaveAttribute("data-start", "0");
    await expect(rendered).toHaveAttribute("data-end", firstPageEnd!);

    // Even a wheel dispatched directly to the underlying text is ignored while a dialog is open.
    const cancelled = await page
      .getByTestId("reader-viewport")
      .evaluate((element) => {
        const event = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 120,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(cancelled).toBe(false);
    await expect(rendered).toHaveAttribute("data-start", "0");
    await expect(rendered).toHaveAttribute("data-end", firstPageEnd!);
  });
});
