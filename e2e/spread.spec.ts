import { expect, test } from "@playwright/test";

// Use a desktop layout viewport for the landscape reader in every browser.
test.use({ viewport: { width: 1280, height: 800 }, isMobile: false });

for (const direction of ["tbRl", "lrTb"] as const) {
  test(`two-page reading ${direction} preserves order, passage, copying and orientation`, async ({
    page,
  }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    const resize = async (size: { width: number; height: number }) => {
      // Firefox on Windows can reflow without acknowledging the resize command.
      // Accept the actual document viewport as confirmation in that case.
      await Promise.race([
        page.setViewportSize(size),
        page.waitForFunction(
          ({ width, height }) =>
            document.documentElement.clientWidth === width &&
            document.documentElement.clientHeight === height,
          size,
        ),
      ]);
    };
    await page.goto("/#/read/000127");
    const rendered = page.getByTestId("reader-page");
    await expect(rendered.locator("svg")).toBeVisible();
    if (direction === "lrTb")
      await page
        .getByRole("button", { name: "横書きに切り替え", exact: true })
        .click();
    await page
      .getByRole("button", { name: "見開き表示に切り替え", exact: true })
      .click();
    await expect(rendered).toHaveAttribute("data-layout", "spread");
    await expect(rendered.locator("svg")).toHaveCount(2);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    const leaves = page.getByTestId("reader-leaf");
    expect(await leaves.nth(1).getAttribute("data-start")).toBe(
      await leaves.nth(0).getAttribute("data-end"),
    );
    const first = (await leaves.nth(0).boundingBox())!;
    const second = (await leaves.nth(1).boundingBox())!;
    expect(direction === "tbRl" ? first.x > second.x : first.x < second.x).toBe(
      true,
    );
    expect(Math.abs(first.width - second.width)).toBeLessThan(1);
    const clipped = await rendered.evaluate((wrapper) =>
      [...wrapper.querySelectorAll("svg")].flatMap((svg) => {
        const root = svg.getBoundingClientRect();
        return [...svg.querySelectorAll("tspan")]
          .filter((el) => el.textContent?.trim())
          .flatMap((el) => {
            const rect = el.getBoundingClientRect();
            return rect.x < root.x - 2 ||
              rect.y < root.y - 2 ||
              rect.right > root.right + 2 ||
              rect.bottom > root.bottom + 2
              ? [el.textContent]
              : [];
          });
      }),
    );
    expect(clipped).toEqual([]);
    const copied = await rendered.evaluate(async (wrapper) => {
      const book = await (await fetch("data/books/000127.json")).json();
      const source = book.blocks
        .map((block: { text: string }) => block.text)
        .join("\n");
      const expected = source.slice(
        Number(wrapper.getAttribute("data-start")),
        Number(wrapper.getAttribute("data-end")),
      );
      const container = wrapper.querySelector(".reader-pages")!;
      const selection = window.getSelection()!;
      const copy = (range: Range) => {
        selection.removeAllRanges();
        selection.addRange(range);
        const data = new DataTransfer();
        const event = new ClipboardEvent("copy", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        });
        container.dispatchEvent(event);
        return {
          text: event.clipboardData?.getData("text/plain") ?? "",
          prevented: event.defaultPrevented,
        };
      };
      const range = document.createRange();
      range.selectNodeContents(container);
      const full = copy(range);
      const svgs = container.querySelectorAll("svg");
      const a = [...svgs[0].querySelectorAll("[data-run]")].at(-5)!;
      const b = svgs[1].querySelectorAll("[data-run]")[4];
      range.setStart(a.firstChild!, 0);
      range.setEnd(b.firstChild!, b.textContent!.length);
      const partial = copy(range);
      const segment = (text: string) =>
        [
          ...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(
            text,
          ),
        ].map((value) => value.segment);
      const start = Number(svgs[0].getAttribute("data-start"));
      const middle = Number(svgs[0].getAttribute("data-end"));
      const end = Number(svgs[1].getAttribute("data-end"));
      const expectedPartial =
        segment(source.slice(start, middle))
          .slice(Number(a.getAttribute("data-run")))
          .join("") +
        segment(source.slice(middle, end))
          .slice(0, Number(b.getAttribute("data-run")) + 1)
          .join("");
      return { full, partial, expected, expectedPartial };
    });
    expect(copied.full).toEqual({ text: copied.expected, prevented: true });
    expect(copied.partial).toEqual({
      text: copied.expectedPartial,
      prevented: true,
    });
    const end = await rendered.getAttribute("data-end");
    await page.getByRole("button", { name: "次のページ", exact: true }).click();
    await expect(rendered).toHaveAttribute("data-start", end!);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await page.getByRole("button", { name: "前のページ", exact: true }).click();
    await expect(rendered).toHaveAttribute("data-start", "0");
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await page.getByRole("button", { name: "次のページ", exact: true }).click();
    await expect(rendered).toHaveAttribute("data-start", end!);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    const block = await rendered.getAttribute("data-block");
    const offset = await rendered.getAttribute("data-offset");
    await page
      .getByRole("button", { name: "読書設定を開く", exact: true })
      .click();
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await expect(rendered.locator("svg")).toHaveCount(2);
    await expect(rendered).toHaveAttribute("data-block", block!);
    await expect(rendered).toHaveAttribute("data-offset", offset!);
    await page
      .getByRole("button", { name: "読書設定を閉じる", exact: true })
      .click();
    await page
      .getByRole("button", { name: "1ページ表示に切り替え", exact: true })
      .click();
    await expect(rendered.locator("svg")).toHaveCount(1);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await expect(rendered).toHaveAttribute("data-block", block!);
    await expect(rendered).toHaveAttribute("data-offset", offset!);
    await page
      .getByRole("button", { name: "見開き表示に切り替え", exact: true })
      .click();
    await resize({ width: 390, height: 844 });
    await expect(rendered).toHaveAttribute("data-layout", "single");
    await expect(rendered.locator("svg")).toHaveCount(1);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await expect(rendered).toHaveAttribute("data-block", block!);
    await expect(rendered).toHaveAttribute("data-offset", offset!);
    await page.reload();
    await expect(rendered.locator("svg")).toHaveCount(1);
    await page
      .getByRole("button", { name: "読書設定を開く", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "ページ表示", exact: true }),
    ).toHaveValue("spread");
    await page
      .getByRole("button", { name: "読書設定を閉じる", exact: true })
      .click();
    await resize({ width: 1280, height: 800 });
    await expect(rendered.locator("svg")).toHaveCount(2);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    await expect(rendered).toHaveAttribute("data-block", block!);
    await expect(rendered).toHaveAttribute("data-offset", offset!);
    expect(failures).toEqual([]);
  });
}

test("the final page keeps its half of the spread and disables further paging", async ({
  page,
}) => {
  await page.route("**/data/books/000127.json", async (route) => {
    const response = await route.fetch();
    const book = await response.json();
    book.blocks = [
      {
        ...book.blocks[0],
        text: "短い作品。",
        rubies: [],
        emphasis: [],
        inlineImages: [],
      },
    ];
    book.toc = [];
    await route.fulfill({ response, json: book });
  });
  await page.goto("/#/read/000127");
  await expect(page.getByTestId("reader-page").locator("svg")).toBeVisible();
  await page
    .getByRole("button", { name: "見開き表示に切り替え", exact: true })
    .click();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(page.locator(".reader-blank-page")).toBeVisible();
  await expect(page.getByTestId("reader-leaf")).toHaveCount(1);
  const first = (await page.getByTestId("reader-leaf").boundingBox())!;
  const blank = (await page.locator(".reader-blank-page").boundingBox())!;
  expect(first.x).toBeGreaterThan(blank.x);
  expect(first.width).toBeCloseTo(blank.width, 2);
  await expect(
    page.getByRole("button", { name: "次のページ", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "前のページ", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".reader-page-bottom")).toContainText("100% 読了");
});
