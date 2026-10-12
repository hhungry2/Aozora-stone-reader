import { expect, test, type Page } from "@playwright/test";

// Original, synthetic stories: these fixtures contain no third-party novel text.
const NAROU = "https://ncode.syosetu.com/n1234ab/";
const KAKUYOMU = "https://kakuyomu.jp/works/123456789";
const SHORT_NAROU = "https://ncode.syosetu.com/n5678cd/";
const SCRIPT_MARKER = "SOURCE_SCRIPT_SHOULD_NOT_RUN";
const webHref = (url: string) => `/#/web/${encodeURIComponent(url)}`;
const html = (body: string) =>
  `<!doctype html><html lang="ja"><head><meta charset="UTF-8"></head><body>${body}</body></html>`;

const narouIndex = html(`
  <h1 class="p-novel__title">風の試作</h1>
  <div class="p-novel__author">作者：<a href="https://mypage.syosetu.com/1/">試作作者</a></div>
  <p class="p-novel__summary">表示を確かめるための短い物語です。</p>
  <div class="p-eplist__chapter-title">始まり</div>
  <a class="p-eplist__subtitle" href="/n1234ab/1/">第一話 風の朝</a>
  <a class="p-eplist__subtitle" href="/n1234ab/2/">第二話 光の道</a>
`);

function narouEpisode(number: 1 | 2) {
  const title = number === 1 ? "第一話 風の朝" : "第二話 光の道";
  const navigation =
    number === 1
      ? '<a class="c-pager__item--next" href="/n1234ab/2/">次へ</a>'
      : '<a class="c-pager__item--before" href="/n1234ab/1/">前へ</a>';
  const paragraphs =
    number === 1
      ? `<p id="first"><ruby>風<rt>かぜ</rt></ruby>と<em class="emphasisDots">光</em>が、朝の窓を訪れた。<script>window.${SCRIPT_MARKER}=true</script><span hidden>非表示の広告文</span></p>${Array.from({ length: 24 }, (_, i) => `<p id="line-${i}">${i + 1}番目の道を歩く。${"小さな風が白い雲を運び、遠くの鐘が朝を知らせた。".repeat(4)}</p>`).join("")}`
      : '<p id="second">第二話の本文。光の道に小さな花が咲いた。</p>';
  return html(`
    <p class="novel_title">風の試作</p>
    <p class="p-novel__subtitle-episode">${title}</p>
    <div class="p-novel__author"><a href="https://mypage.syosetu.com/1/">試作作者</a></div>
    <div class="p-novel__text js-novel-text">${paragraphs}</div>
    ${navigation}
  `);
}

const apollo = {
  props: {
    pageProps: {
      __APOLLO_STATE__: {
        "Work:123456789": {
          title: "星の試作",
          author: { __ref: "User:1" },
          catchphrase: "夜を測る短い話。",
          tableOfContentsV2: [{ __ref: "Section:1" }],
        },
        "User:1": { activityName: "星の作者" },
        "Section:1": {
          chapter: { __ref: "Chapter:1" },
          episodeUnions: [{ __ref: "Episode:987654321" }],
        },
        "Chapter:1": { title: "夜の章" },
        "Episode:987654321": {
          __typename: "Episode",
          id: "987654321",
          title: "第一夜 星の窓",
        },
      },
    },
  },
};
const kakuyomuIndex = html(
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(apollo)}</script>`,
);
const kakuyomuEpisode = html(`
  <h1 id="workTitle">星の試作</h1><p id="workAuthor-activityName">星の作者</p>
  <h2 class="widget-episodeTitle">第一夜 星の窓</h2>
  <div class="widget-episodeBody"><p id="star"><ruby>星<rt>ほし</rt></ruby>の窓から、小さな夜が見えた。<script>window.${SCRIPT_MARKER}=true</script></p></div>
`);

async function mockNovels(page: Page) {
  const requests: string[] = [];
  const sources: Record<string, string> = {
    [NAROU]: narouIndex,
    [`${NAROU}1/`]: narouEpisode(1),
    [`${NAROU}2/`]: narouEpisode(2),
    [KAKUYOMU]: kakuyomuIndex,
    [`${KAKUYOMU}/episodes/987654321`]: kakuyomuEpisode,
    [SHORT_NAROU]: html(
      '<h1 class="p-novel__title">短編の試作</h1><p class="p-novel__author">試作作者</p><div id="novel_honbun"><p>短い午後に、小さな風が通り過ぎた。</p></div>',
    ),
  };
  await page.route("**/__web-novel?**", async (route) => {
    const source = new URL(route.request().url()).searchParams.get("url") || "";
    requests.push(source);
    expect(new URL(route.request().url()).searchParams.get("charset")).toBe(
      "UTF-8",
    );
    await route.fulfill({
      status: sources[source] ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(
        sources[source]
          ? { ok: true, url: source, html: sources[source] }
          : { ok: false, error: "テスト用の作品がありません。" },
      ),
    });
  });
  return requests;
}

async function ready(page: Page, mode: "stone" | "css" = "stone") {
  await expect(page.getByTestId("reader")).toHaveAttribute("data-engine", mode);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  const rendered = page.getByTestId("reader-page");
  if (mode === "stone") await expect(rendered.locator("svg")).toBeVisible();
  else
    await expect(
      page.getByTestId("css-reader").locator("[data-css-block]").first(),
    ).toBeAttached();
}

async function chooseEngine(page: Page, mode: "stone" | "css") {
  await page
    .getByRole("button", { name: "読書設定を開く", exact: true })
    .click();
  await page
    .getByRole("complementary", { name: "読書の設定" })
    .getByLabel("表示エンジン", { exact: true })
    .selectOption(mode);
  await ready(page, mode);
  await page
    .getByRole("button", { name: "読書設定を閉じる", exact: true })
    .click();
}

test("Narou's current index opens annotated text and moves between episodes through the TOC", async ({
  page,
}) => {
  const requests = await mockNovels(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(40);
  await expect(page.locator(".book-card").first()).toContainText("こころ");
  await page
    .getByLabel("作品・各話のURL", { exact: true })
    .fill(`${NAROU}?tracking=1#top`);
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "風の試作", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "始まり", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "第一話 風の朝", exact: true }).click();
  await ready(page);
  const rendered = page.getByTestId("reader-page");
  await expect(rendered.locator(".reader-accessible-text")).toContainText(
    "と光が、朝の窓を訪れた。",
  );
  await expect(
    rendered.locator(".reader-accessible-text ruby rt").first(),
  ).toHaveText("かぜ");
  await expect(rendered.locator(".reader-rubies tspan").first()).toBeVisible();
  expect(await rendered.locator("svg circle").count()).toBeGreaterThan(0);
  await expect(rendered).not.toContainText(SCRIPT_MARKER);
  await expect(rendered).not.toContainText("非表示の広告文");
  expect(
    await page.evaluate(
      (marker) => (window as unknown as Record<string, unknown>)[marker],
      SCRIPT_MARKER,
    ),
  ).toBeUndefined();
  await page.getByRole("button", { name: "目次を開く", exact: true }).click();
  await page
    .getByRole("dialog", { name: "目次", exact: true })
    .getByRole("navigation", { name: "話の移動", exact: true })
    .getByRole("link", { name: "次の話", exact: true })
    .click();
  await ready(page);
  await expect(rendered.locator(".reader-accessible-text")).toContainText(
    "第二話の本文。",
  );
  await page.getByRole("button", { name: "目次を開く", exact: true }).click();
  const navigation = page
    .getByRole("dialog", { name: "目次", exact: true })
    .getByRole("navigation", { name: "話の移動", exact: true });
  await expect(
    navigation.getByRole("link", { name: "前の話", exact: true }),
  ).toHaveAttribute("href", `#/web/${encodeURIComponent(`${NAROU}1/`)}`);
  expect([...new Set(requests)]).toEqual([NAROU, `${NAROU}1/`, `${NAROU}2/`]);
  expect(errors).toEqual([]);
});

test("Kakuyomu Apollo V2 index opens the episode with a link to its source", async ({
  page,
}) => {
  await mockNovels(page);
  await page.goto(webHref(KAKUYOMU));
  await expect(
    page.getByRole("heading", { name: "星の試作", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "夜の章", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "第一夜 星の窓", exact: true }).click();
  await ready(page);
  await expect(
    page.getByTestId("reader-page").locator(".reader-accessible-text"),
  ).toContainText("の窓から、小さな夜が見えた。");
  await expect(
    page
      .getByTestId("reader-page")
      .locator(".reader-accessible-text ruby rt")
      .first(),
  ).toHaveText("ほし");
  await page
    .getByRole("button", { name: "作品情報を開く", exact: true })
    .click();
  const source = page.getByRole("link", {
    name: "カクヨムで原文を開く",
    exact: true,
  });
  await expect(source).toHaveAttribute(
    "href",
    `${KAKUYOMU}/episodes/987654321`,
  );
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(source).toHaveAttribute("rel", "noreferrer");
  expect(
    await page.evaluate(
      (marker) => (window as unknown as Record<string, unknown>)[marker],
      SCRIPT_MARKER,
    ),
  ).toBeUndefined();
});

test("Web-novel bookmarks and reading position survive engine changes and revisiting recent metadata", async ({
  page,
}) => {
  await mockNovels(page);
  await page.goto(webHref(`${NAROU}1/`));
  await ready(page);
  const rendered = page.getByTestId("reader-page");
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await ready(page);
  await expect(rendered).not.toHaveAttribute("data-start", "0");
  const savedStart = Number(await rendered.getAttribute("data-start"));
  await page
    .getByRole("button", { name: "このページにしおりを挟む", exact: true })
    .click();
  const recordKey = "aozora-stone-reader:v1:record:web-narou-n1234ab-1";
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key) || "{}").bookmarks?.length,
        recordKey,
      ),
    )
    .toBe(1);
  await chooseEngine(page, "css");
  await expect(
    page.getByTestId("css-reader").locator("ruby rt").first(),
  ).toHaveText("かぜ");
  await expect(
    page.getByTestId("css-reader").locator(".css-reader-emphasis").first(),
  ).toHaveText("光");
  await expect
    .poll(async () => {
      const start = Number(await rendered.getAttribute("data-start"));
      const end = Number(await rendered.getAttribute("data-end"));
      return start <= savedStart && end > savedStart;
    })
    .toBe(true);
  await chooseEngine(page, "stone");
  await page
    .getByRole("button", { name: "しおり一覧を開く", exact: true })
    .click();
  await expect(page.locator(".bookmark-item")).toHaveCount(1);
  await page.locator(".bookmark-jump").click();
  await expect(rendered).toHaveAttribute("data-start", String(savedStart));
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(40);
  const recent = page.locator(".web-novel-recent");
  await expect(
    recent.getByRole("link", { name: "風の試作", exact: true }),
  ).toBeVisible();
  const metadata = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("aozora-stone-reader:v1:web-novel-recent") || "[]",
    ),
  );
  expect(metadata).toHaveLength(1);
  expect(metadata[0]).toMatchObject({
    url: `${NAROU}1/`,
    title: "風の試作",
    author: "試作作者",
    siteName: "小説家になろう",
  });
  expect(metadata[0]).not.toHaveProperty("html");
  expect(metadata[0]).not.toHaveProperty("book");
  await recent.getByRole("link", { name: "風の試作", exact: true }).click();
  await ready(page);
  await expect(rendered).toHaveAttribute("data-start", String(savedStart));
  await page.reload();
  await ready(page);
  await expect(rendered).toHaveAttribute("data-start", String(savedStart));
  await page
    .getByRole("button", { name: "しおり一覧を開く", exact: true })
    .click();
  await expect(page.locator(".bookmark-item")).toHaveCount(1);
});

test("unsupported and HTTP URLs are rejected, while a failed HTTP fetch can be retried", async ({
  page,
}) => {
  let deny = true;
  const requests: string[] = [];
  await page.route("**/__web-novel?**", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: deny ? 403 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        deny
          ? { ok: false, error: "取得が拒否されました。" }
          : { ok: true, url: `${NAROU}2/`, html: narouEpisode(2) },
      ),
    });
  });
  await page.goto("/");
  for (const url of [
    "http://ncode.syosetu.com/n1234ab/",
    "https://example.com/novel",
  ]) {
    await page.getByLabel("作品・各話のURL", { exact: true }).fill(url);
    await page.getByRole("button", { name: "開く", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("HTTPS URL");
    await expect(page).toHaveURL(/\/$/u);
  }
  expect(requests).toEqual([]);
  await page.getByLabel("作品・各話のURL", { exact: true }).fill(`${NAROU}2/`);
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Web小説を開けませんでした",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("403");
  const attemptsBeforeRetry = requests.length;
  deny = false;
  await page
    .getByRole("button", { name: "もう一度読み込む", exact: true })
    .click();
  await ready(page);
  await expect(
    page.getByTestId("reader-page").locator(".reader-accessible-text"),
  ).toContainText("第二話の本文。");
  expect(requests.length).toBeGreaterThan(attemptsBeforeRetry);
});

test("a user-owned Apps Script endpoint is saved and used for subsequent requests", async ({
  page,
}) => {
  const endpoint = "https://script.google.com/macros/s/test-deployment/exec";
  const requests: string[] = [];
  await page.route(`${endpoint}?**`, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        ok: true,
        url: `${NAROU}2/`,
        html: narouEpisode(2),
      }),
    });
  });
  await page.goto("/");
  await page.getByText("Web小説の接続設定", { exact: true }).click();
  await page
    .getByLabel("Google Apps Scriptの公開URL", { exact: true })
    .fill(endpoint);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.locator(".web-novel-connection").getByRole("status"),
  ).toContainText("接続設定を保存しました");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("aozora-stone-reader:v1:web-novel-proxy"),
    ),
  ).toBe(endpoint);
  await page.getByLabel("作品・各話のURL", { exact: true }).fill(`${NAROU}2/`);
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await ready(page);
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    const actual = new URL(request);
    expect(`${actual.origin}${actual.pathname}`).toBe(endpoint);
    expect(actual.searchParams.get("url")).toBe(`${NAROU}2/`);
    expect(actual.searchParams.get("charset")).toBe("UTF-8");
  }
  await page.reload();
  await ready(page);
  await expect(
    page.getByTestId("reader-page").locator(".reader-accessible-text"),
  ).toContainText("第二話の本文。");
});

test("a short Narou story without chapters returns directly to the bookshelf", async ({
  page,
}) => {
  await mockNovels(page);
  await page.goto(webHref(SHORT_NAROU));
  await ready(page);
  await expect(
    page.getByTestId("reader-page").locator(".reader-accessible-text"),
  ).toContainText("短い午後に、小さな風が通り過ぎた。");
  await expect(
    page.getByRole("button", { name: "目次を開く", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "本棚へ", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Web小説を読む", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".book-card")).toHaveCount(40);
  await expect(page.locator(".book-card").first()).toContainText("こころ");
  await expect(
    page
      .locator(".web-novel-recent")
      .getByRole("link", { name: "短編の試作", exact: true }),
  ).toBeVisible();
});
