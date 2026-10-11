import { expect, test, type Page } from "@playwright/test";
import catalog from "../public/data/catalog.json" with { type: "json" };

const originalIds = new Set([
  "000127",
  "000042",
  "000092",
  "043015",
  "043016",
  "000069",
  "000179",
  "001567",
  "000270",
  "000277",
  "043754",
  "000456",
  "000470",
  "043752",
  "000473",
  "000789",
  "000799",
  "000752",
  "000424",
  "000624",
]);
const titleCounts = new Map<string, number>();
for (const work of catalog)
  titleCounts.set(work.title, (titleCounts.get(work.title) || 0) + 1);

async function expectResults(page: Page, count: number) {
  await expect(page.locator(".book-card")).toHaveCount(Math.min(40, count));
  await expect(page.locator(".collection-results")).toHaveText(
    `${count} / ${catalog.length}作品`,
  );
}

test("the expanded collection can be found by title, reading and multiple search words", async ({
  page,
}) => {
  await page.goto("/");
  await expectResults(page, catalog.length);
  const search = page.getByRole("searchbox", { name: "作品名・作家名で検索" });
  await expect(search).toHaveAttribute(
    "placeholder",
    "作品名・作家名・読みで探す",
  );
  await expect(search).toHaveAccessibleDescription(
    "作品名・作家名・読みで検索できます。空白で区切ると、すべての言葉を含む作品を探せます。",
  );
  await page.getByRole("link", { name: "作品を探す", exact: true }).click();
  await expect(search).toBeFocused();
  await expect(
    page.getByRole("button", { name: "検索条件をクリア" }),
  ).toHaveCount(0);

  for (const query of ["羅生門", "らしょうもん", "ラショウモン", "ﾗｼｮｳﾓﾝ"]) {
    await search.fill(query);
    await expectResults(
      page,
      catalog.filter((book) => book.title.includes("羅生門")).length,
    );
    await expect(
      page.locator('.book-card a[href="#/read/000127"]'),
    ).toBeVisible();
  }
  await search.fill("ｱｸﾀｶﾞﾜ　河童");
  await expectResults(
    page,
    catalog.filter(
      (book) =>
        book.title.includes("河童") &&
        book.authors.some((person) => person.name.includes("芥川")),
    ).length,
  );
  await expect(
    page.locator('.book-card a[href="#/read/000069"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "検索語を消す", exact: true }).click();
  await expect(search).toBeFocused();
  await expectResults(page, catalog.length);
});

test("author, length and search filters combine, and clearing restores the full collection", async ({
  page,
}) => {
  await page.goto("/");
  await expectResults(page, catalog.length);
  const author = page.getByRole("combobox", { name: "作家で絞り込み" });
  const labels = await author.locator("option").allTextContents();
  expect(labels[0]).toBe("すべての作家");
  expect(labels.slice(1).sort()).toEqual(
    [
      ...new Set(
        catalog.flatMap((book) => book.authors.map((person) => person.name)),
      ),
    ].sort(),
  );
  await author.selectOption("夏目漱石");
  await page.getByRole("button", { name: "長編", exact: true }).click();
  const longNovels = catalog.filter(
    (book) =>
      book.authors.some((person) => person.name === "夏目漱石") &&
      book.characterCount >= 30000,
  );
  expect(longNovels.length).toBeGreaterThan(0);
  await expectResults(page, longNovels.length);
  expect(
    (await page.locator(".book-card h3 a").allTextContents()).every((title) =>
      longNovels.some((book) => book.title === title),
    ),
  ).toBe(true);
  const search = page.getByRole("searchbox", { name: "作品名・作家名で検索" });
  await search.fill("猫");
  await expectResults(
    page,
    longNovels.filter((book) => book.title.includes("猫")).length,
  );
  await expect(
    page.locator('.book-card a[href="#/read/000789"]'),
  ).toBeVisible();

  await search.fill("未収録の作品_検索テスト_314159");
  await expectResults(page, 0);
  await expect(
    page.getByRole("heading", { name: "お探しの作品が見つかりませんでした" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "検索条件をクリア" }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(author).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "すべて", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectResults(page, catalog.length);

  await page.getByRole("button", { name: "短編", exact: true }).click();
  await expectResults(
    page,
    catalog.filter((book) => book.dataPath && book.characterCount < 30000)
      .length,
  );
  await page.getByRole("button", { name: "最近読んだ本", exact: true }).click();
  await expectResults(page, 0);
  await expect(
    page.getByRole("heading", { name: "読書の記録はこれから。" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "すべての作品を見る", exact: true })
    .click();
  await expectResults(page, catalog.length);
});

test("a newly added work opens from search in both writing directions with its source and reading history", async ({
  page,
}) => {
  const added = catalog.filter(
    (book) =>
      !originalIds.has(book.id) &&
      book.dataPath.endsWith(".gz") &&
      book.characterCount >= 300 &&
      book.title.length > 3 &&
      !book.subtitle &&
      titleCounts.get(book.title) === 1,
  );
  expect(added.length).toBeGreaterThan(0);
  const work = added.sort((a, b) => a.characterCount - b.characterCount)[0];
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/");
  await expectResults(page, catalog.length);
  await page.getByRole("searchbox").fill(work.title);
  await page.locator(`.book-card h3 a[href="#/read/${work.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/read/${work.id}$`, "u"));
  const rendered = page.getByTestId("reader-page");
  for (const direction of ["tbRl", "lrTb"]) {
    if (direction === "lrTb")
      await page.getByRole("button", { name: "横書きに切り替え" }).click();
    await expect(rendered.locator("svg")).toHaveAttribute(
      "data-stone-direction",
      direction,
    );
    await expect(rendered).toHaveAttribute("data-start", "0");
    await expect(rendered.locator(".reader-opening")).toHaveText(
      `${work.title}${work.authorLabel}`,
    );
    await expect(rendered.locator(".reader-accessible-text")).not.toHaveText(
      "",
    );
  }
  await page
    .locator('.reader-header button[aria-controls="reader-work-info"]')
    .click();
  const info = page.getByRole("region", { name: "作品情報の詳細" });
  await expect(info).toBeVisible();
  await expect(
    info.getByRole("link", { name: "青空文庫の図書カード" }),
  ).toHaveAttribute("href", work.cardUrl);
  await info.locator(".reader-credits > summary").click();
  await expect(info.locator(".credits")).not.toHaveText("");
  await page.getByRole("link", { name: "本棚へ", exact: true }).click();
  await page.getByRole("button", { name: "検索条件をクリア" }).click();
  await page.getByRole("button", { name: "最近読んだ本", exact: true }).click();
  await expectResults(page, 1);
  await expect(page.locator(".book-card h3 a")).toHaveText(work.title);
  await page.getByRole("button", { name: "検索条件をクリア" }).click();
  await expectResults(page, catalog.length);
  expect(failures).toEqual([]);
});

test("the complete catalog pages through bounded cards and resets after a search", async ({
  page,
}) => {
  await page.goto("/");
  await expectResults(page, catalog.length);
  const first = await page
    .locator(".book-card h3 a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  const pagination = page.getByRole("navigation", { name: "本棚のページ" });
  const previous = pagination.getByRole("button", { name: "前の40作品" });
  const next = pagination.getByRole("button", { name: "次の40作品" });
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(pagination.getByRole("spinbutton")).toHaveValue("2");
  expect(
    await page
      .locator(".book-card h3 a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
  ).not.toEqual(first);
  await previous.click();
  expect(
    await page
      .locator(".book-card h3 a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
  ).toEqual(first);
  await pagination
    .getByRole("spinbutton")
    .fill(String(Math.ceil(catalog.length / 40)));
  await expect(next).toBeDisabled();
  await expect(page.locator(".book-card")).toHaveCount(
    catalog.length % 40 || 40,
  );
  await page.getByRole("searchbox").fill("夏目 漱石 こころ");
  await expect(pagination.getByRole("spinbutton")).toHaveValue("1");
  await expect(
    page.locator('.book-card a[href="#/read/000773"]'),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("検索テスト_存在しない_314159");
  await expect(page.locator(".book-card")).toHaveCount(0);
  await expect(pagination).toHaveCount(0);
});

test("source-only entries remain searchable and link to their official card", async ({
  page,
}) => {
  const work = catalog.find((entry) => !entry.dataPath)!;
  expect(work).toBeTruthy();
  const bodyRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/data/books/"))
      bodyRequests.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("searchbox").fill(work.title);
  await page.locator(`.book-card a[href="#/read/${work.id}"]`).click();
  await expect(
    page.getByRole("heading", { name: work.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "青空文庫の図書カード" }),
  ).toHaveAttribute("href", work.cardUrl);
  expect(bodyRequests).toEqual([]);
});

test("an illustrated work displays a large figure in both writing directions", async ({
  page,
}) => {
  await page.goto("/#/read/043603");
  const rendered = page.getByTestId("reader-page");
  for (const direction of ["tbRl", "lrTb"]) {
    if (direction === "lrTb")
      await page.getByRole("button", { name: "横書きに切り替え" }).click();
    await expect(rendered.locator("svg")).toHaveAttribute(
      "data-stone-direction",
      direction,
    );
    const figure = rendered.locator("svg image");
    await expect(figure).toHaveCount(1);
    expect(Number(await figure.getAttribute("width"))).toBeGreaterThan(100);
    expect(Number(await figure.getAttribute("height"))).toBeGreaterThan(100);
    await expect(figure).toHaveAttribute(
      "preserveAspectRatio",
      "xMidYMid meet",
    );
  }
});

test.describe("narrow collection", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("search and author controls stay usable without horizontal overflow at 320 pixels", async ({
    page,
  }) => {
    await page.goto("/");
    await expectResults(page, catalog.length);
    await page.getByRole("link", { name: "作品を探す", exact: true }).click();
    const search = page.getByRole("searchbox");
    await expect(search).toBeFocused();
    await search.fill(
      "検索条件が画面幅より長い場合も入力欄の中で扱えることを確認する".repeat(
        4,
      ),
    );
    await page
      .getByRole("combobox", { name: "作家で絞り込み" })
      .selectOption("芥川竜之介");
    await expectResults(page, 0);
    for (const control of [
      search,
      page.getByRole("combobox", { name: "作家で絞り込み" }),
      page.getByRole("combobox", { name: "並べ替え" }),
      page.getByRole("button", { name: "検索条件をクリア" }),
    ]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await page.getByRole("button", { name: "検索条件をクリア" }).click();
    await expectResults(page, catalog.length);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
  });
});
