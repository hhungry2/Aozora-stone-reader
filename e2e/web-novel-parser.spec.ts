import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { WebNovelPage } from "../src/lib/web-novel";

const narouWork = "https://ncode.syosetu.com/n1234ab/";
const kakuyomuWork = "https://kakuyomu.jp/works/100";

async function fixture(name: string) {
  return readFile(
    new URL(`../tests/fixtures/web-novel/${name}.html`, import.meta.url),
    "utf8",
  );
}

async function parse(
  page: Page,
  html: string,
  url: string,
): Promise<WebNovelPage> {
  return page.evaluate(
    async ({ html, url }) => {
      const path = "/src/lib/web-novel.ts";
      const { parseWebNovel } = await import(path);
      return parseWebNovel(html, url);
    },
    { html, url },
  );
}

test.beforeEach(async ({ page, baseURL }) => {
  // These are synthetic fixtures: parsing must not contact the novel sites.
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(baseURL!).origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/");
});

test("extracts current Narou chapters and paginated indexes within one work", async ({
  page,
}) => {
  const result = await parse(
    page,
    await fixture("narou-current-index"),
    `${narouWork}?p=2`,
  );
  expect(result.book).toBeNull();
  expect(result.info.title).toBe("合成された作品");
  expect(result.info.author).toBe("テスト作者");
  expect(result.info.description).toBe("目次を検証するための短い架空の作品。");
  expect(result.info.episodes).toEqual([
    { title: "第一話", url: `${narouWork}1/`, chapter: "第一章" },
    { title: "第二話", url: `${narouWork}2/`, chapter: "第一章" },
  ]);
  expect(result.info.indexPagePreviousUrl).toBe(`${narouWork}?p=1`);
  expect(result.info.indexPageNextUrl).toBe(`${narouWork}?p=3`);
  expect(result.info.previousUrl).toBeUndefined();
  expect(result.info.nextUrl).toBeUndefined();
});

test("keeps UTF-16 ruby, emphasis, blank lines and headings in current Narou prose", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const result = await parse(
    page,
    await fixture("narou-current-episode"),
    `${narouWork}2/`,
  );
  expect(result.info.title).toBe("合成された作品");
  expect(result.info.episodeTitle).toBe("第二話");
  expect(result.info.previousUrl).toBe(`${narouWork}1/`);
  expect(result.info.nextUrl).toBe(`${narouWork}3/`);
  const book = result.book!;
  expect(book.blocks[0].kind).toBe("note");
  expect(book.blocks.at(-1)?.kind).toBe("note");
  const line = book.blocks.find((block) => block.text.startsWith("　😀"))!;
  expect(line.text).toBe("　😀漢字と大事。");
  expect(line.rubies).toEqual([{ start: 3, end: 5, reading: "かんじ" }]);
  expect(line.emphasis).toEqual([{ start: 6, end: 8, kind: "sesame_dot" }]);
  expect(book.blocks.filter((block) => block.text === "")).toHaveLength(2);
  expect(book.blocks.some((block) => block.text === "前半")).toBe(true);
  expect(book.blocks.some((block) => block.text === "後半")).toBe(true);
  expect(book.toc).toEqual([
    { title: "小さな節", blockId: book.blocks[1].id, level: 2 },
  ]);
  const text = book.blocks.map((block) => block.text).join("\n");
  expect(text).not.toMatch(/広告|悪い文字|余分な文字|隠れた文章/u);
  expect(text).toContain("リンク先を除いた文章");
  expect(JSON.stringify(book)).not.toContain("javascript:");
  const images = book.blocks.flatMap((block) => block.inlineImages);
  expect(images).toHaveLength(1);
  expect(images[0].src).toBe("https://images.example.com/story.png");
  expect(images[0].sourceUrl).toBe(images[0].src);
  expect(book.credits).toContain("著作権は原作者");
  expect(book.credits).toContain("青空文庫の著作権切れ収録作品とは別");
  expect(book.source.sha256).toBe("");
  expect(errors).toEqual([]);
});

test("recognizes a legacy Narou short story as a readable book", async ({
  page,
}) => {
  const result = await parse(
    page,
    await fixture("narou-legacy-short"),
    narouWork,
  );
  expect(result.info.title).toBe("昔の短編");
  expect(result.info.author).toBe("架空の人");
  expect(result.info.episodeTitle).toBe("");
  expect(result.info.nextUrl).toBeUndefined();
  expect(result.book?.blocks[0].rubies).toEqual([
    { start: 2, end: 4, reading: "ものがたり" },
  ]);
});

test("reads Kakuyomu Apollo V2 while excluding locked episodes and invalid IDs", async ({
  page,
}) => {
  const result = await parse(
    page,
    await fixture("kakuyomu-v2-index"),
    kakuyomuWork,
  );
  expect(result.book).toBeNull();
  expect(result.info.title).toBe("架空の作品");
  expect(result.info.author).toBe("架空の作者");
  expect(result.info.description).toBe("架空の紹介\n短い説明。");
  expect(result.info.episodes).toEqual([
    {
      title: "最初の話",
      url: `${kakuyomuWork}/episodes/201`,
      chapter: "第一章",
    },
    { title: "次の話", url: `${kakuyomuWork}/episodes/202`, chapter: "第一章" },
    {
      title: "最後の話",
      url: `${kakuyomuWork}/episodes/203`,
      chapter: "第二章",
    },
  ]);
});

test("retains the legacy Kakuyomu Apollo table-of-contents shape", async ({
  page,
}) => {
  const result = await parse(
    page,
    await fixture("kakuyomu-old-index"),
    kakuyomuWork,
  );
  expect(result.book).toBeNull();
  expect(result.info.title).toBe("昔の目次");
  expect(result.info.author).toBe("昔の作者");
  expect(result.info.episodes).toEqual([
    { title: "昔の話", url: `${kakuyomuWork}/episodes/201`, chapter: "第一章" },
  ]);
});

test("falls back to Kakuyomu HTML indexes without unrelated or unsafe links", async ({
  page,
}) => {
  const result = await parse(
    page,
    await fixture("kakuyomu-html-index"),
    kakuyomuWork,
  );
  expect(result.book).toBeNull();
  expect(result.info.title).toBe("HTMLだけの目次");
  expect(result.info.author).toBe("HTMLの作者");
  expect(result.info.episodes).toEqual([
    { title: "一番目", url: `${kakuyomuWork}/episodes/201`, chapter: "第一章" },
    { title: "二番目", url: `${kakuyomuWork}/episodes/202`, chapter: "第一章" },
  ]);
});

test("keeps both native ruby forms, emphasis and safe relative images in Kakuyomu", async ({
  page,
}) => {
  const result = await parse(
    page,
    await fixture("kakuyomu-current-episode"),
    `${kakuyomuWork}/episodes/202`,
  );
  expect(result.info.title).toBe("架空の作品");
  expect(result.info.episodeTitle).toBe("次の話");
  expect(result.info.previousUrl).toBe(`${kakuyomuWork}/episodes/201`);
  expect(result.info.nextUrl).toBe(`${kakuyomuWork}/episodes/203`);
  const blocks = result.book!.blocks;
  expect(blocks[0].rubies).toEqual([
    { start: 2, end: 3, reading: "とう" },
    { start: 3, end: 4, reading: "きょう" },
  ]);
  expect(blocks[1].rubies).toEqual([
    { start: 0, end: 1, reading: "いち" },
    { start: 1, end: 2, reading: "に" },
  ]);
  expect(blocks[1].emphasis).toEqual([
    { start: 3, end: 5, kind: "sesame_dot" },
  ]);
  expect(blocks[2].inlineImages[0].src).toBe(
    "https://kakuyomu.jp/images/example.png",
  );
  expect(blocks[3].emphasis).toEqual([
    { start: 0, end: 1, kind: "sesame_dot" },
  ]);
  expect(blocks.map((block) => block.text).join("\n")).not.toMatch(
    /広告|iframe/u,
  );
});

test("retains block IDs and content versions across fetches and unrelated HTML changes", async ({
  page,
}) => {
  const html = await fixture("narou-current-episode");
  const original = (await parse(page, html, `${narouWork}2/`)).book!;
  const again = (
    await parse(
      page,
      html.replace("広告の文章", "違う広告"),
      `${narouWork}2/?tracking=discard#main`,
    )
  ).book!;
  expect(again.id).toBe(original.id);
  expect(again.blocks).toEqual(original.blocks);
  expect(again.contentVersion).toBe(original.contentVersion);
  const inserted = (
    await parse(
      page,
      html.replace('<p id="L1">', '<p id="L0">新しい段落。</p><p id="L1">'),
      `${narouWork}2/`,
    )
  ).book!;
  const line = original.blocks.find((block) => block.text.startsWith("　😀"))!;
  expect(inserted.blocks.find((block) => block.text === line.text)?.id).toBe(
    line.id,
  );
  expect(inserted.contentVersion).not.toBe(original.contentVersion);
});

test("rejects pages without a public story or index", async ({ page }) => {
  const message = await page.evaluate(async () => {
    const path = "/src/lib/web-novel.ts";
    const { parseWebNovel } = await import(path);
    try {
      parseWebNovel(
        "<html><body>ログインが必要です</body></html>",
        "https://kakuyomu.jp/works/100/episodes/202",
      );
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(message).toContain("本文や目次を見つけられませんでした");
});
