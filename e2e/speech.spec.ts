import { expect, test, type Page } from "@playwright/test";
import { defaultSettings, type Book, type ReaderSettings } from "../src/types";

const fixture: Book = {
  id: "000277",
  title: "読み上げの試作",
  titleKana: "",
  subtitle: "",
  authors: [],
  authorLabel: "試作作者",
  cardUrl: "",
  dataPath: "data/books/000277.json",
  contentVersion: "speech-test",
  characterCount: 2000,
  excerpt: "",
  features: [],
  schemaVersion: 1,
  blocks: [
    {
      id: "first",
      kind: "paragraph",
      text: "風と光が来た。「次の文。」",
      rubies: [{ start: 0, end: 1, reading: "かぜ" }],
      emphasis: [],
      inlineImages: [],
      indent: 0,
    },
    {
      id: "long",
      kind: "paragraph",
      text: "長い道を歩く。".repeat(200),
      rubies: [],
      emphasis: [],
      inlineImages: [],
      indent: 0,
    },
    {
      id: "last",
      kind: "paragraph",
      text: "最後の文。",
      rubies: [],
      emphasis: [],
      inlineImages: [],
      indent: 0,
    },
  ],
  toc: [{ title: "終わり", blockId: "last", level: 1 }],
  credits: "",
  source: { url: "", fetchedAt: "", sha256: "", encoding: "UTF-8" },
  conversion: { version: "test", warnings: [] },
};

async function setup(
  page: Page,
  preferences: Partial<ReaderSettings> = {},
  options: { voicesInitiallyEmpty?: boolean; supported?: boolean } = {},
) {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/data/catalog.json*", (route) =>
    route.fulfill({
      json: [
        fixture,
        { ...fixture, id: "speech-cover-2" },
        { ...fixture, id: "speech-cover-3" },
      ],
    }),
  );
  await page.route("**/data/books/000277.json*", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.addInitScript(
    ({ settings, empty, supported }) => {
      if (!localStorage.getItem("aozora-stone-reader:v1:settings"))
        localStorage.setItem(
          "aozora-stone-reader:v1:settings",
          JSON.stringify({ ...settings, settingsVersion: 2 }),
        );
      const calls: {
        method: string;
        text?: string;
        rate?: number;
        voice?: string;
        lang?: string;
      }[] = [];
      const voices = [
        {
          voiceURI: "en-test",
          name: "English",
          lang: "en-US",
          default: true,
          localService: true,
        },
        {
          voiceURI: "ja-test",
          name: "日本語の試作音声",
          lang: "ja-JP",
          default: false,
          localService: true,
        },
      ];
      let available = empty ? [] : voices;
      let current: any = null;
      let previous: any = null;
      class Utterance {
        text: string;
        lang = "";
        rate = 1;
        voice: any = null;
        onstart: any = null;
        onend: any = null;
        onerror: any = null;
        constructor(text: string) {
          this.text = text;
        }
      }
      const synth = new EventTarget() as any;
      synth.getVoices = () => {
        calls.push({ method: "getVoices" });
        return available;
      };
      synth.speak = (utterance: any) => {
        current = utterance;
        calls.push({
          method: "speak",
          text: utterance.text,
          rate: utterance.rate,
          voice: utterance.voice?.voiceURI,
          lang: utterance.lang,
        });
        utterance.onstart?.();
      };
      synth.cancel = () => {
        calls.push({ method: "cancel" });
        previous = current;
        current = null;
        previous?.onerror?.({ error: "canceled" });
      };
      synth.resume = () => calls.push({ method: "resume" });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: supported ? Utterance : undefined,
        configurable: true,
      });
      Object.defineProperty(window, "speechSynthesis", {
        value: synth,
        configurable: true,
      });
      (window as any).speechTest = {
        calls,
        finish: () => {
          const utterance = current;
          current = null;
          utterance?.onend?.();
        },
        staleEnd: () => previous?.onend?.(),
        fail: (error: string) => current?.onerror?.({ error }),
        loadVoices: () => {
          available = voices;
          synth.dispatchEvent(new Event("voiceschanged"));
        },
      };
    },
    {
      settings: { ...defaultSettings, ...preferences },
      empty: options.voicesInitiallyEmpty ?? false,
      supported: options.supported ?? true,
    },
  );
  await page.goto("/#/read/000277", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  const start = page.getByRole("button", {
    name: "ここから読み上げる",
    exact: true,
  });
  if (options.supported === false) await expect(start).toBeDisabled();
  else await expect(start).toBeEnabled();
}
const speechCalls = (page: Page) =>
  page.evaluate(() =>
    (window as any).speechTest.calls.filter(
      (call: any) => call.method === "speak",
    ),
  );
const finish = (page: Page) =>
  page.evaluate(() => (window as any).speechTest.finish());

for (const mode of ["stone", "scroll", "spread", "css"] as const) {
  test(`${mode}: reads ruby continuously, pauses, resumes and stops without stale callbacks`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await setup(page, {
      renderingMode: mode === "css" ? "css" : "stone",
      viewMode: mode === "scroll" ? "scroll" : "pages",
      pageLayout: mode === "spread" ? "spread" : "single",
    });
    expect(await speechCalls(page)).toHaveLength(0);
    expect(
      await page.evaluate(() =>
        (window as any).speechTest.calls.some(
          (call: any) => call.method === "getVoices",
        ),
      ),
    ).toBe(false);
    await page
      .getByRole("button", { name: "ここから読み上げる", exact: true })
      .click();
    expect((await speechCalls(page))[0]).toMatchObject({
      text: "かぜと光が来た。",
      voice: "ja-test",
      lang: "ja-JP",
      rate: 1,
    });
    await finish(page);
    expect((await speechCalls(page))[1].text).toBe("「次の文。」");
    await page
      .getByRole("button", { name: "読み上げを一時停止", exact: true })
      .click();
    await page.evaluate(() => (window as any).speechTest.staleEnd());
    expect(await speechCalls(page)).toHaveLength(2);
    await page
      .getByRole("button", { name: "読み上げを再開", exact: true })
      .click();
    expect((await speechCalls(page))[2].text).toBe("「次の文。」");
    const before = await page
      .getByTestId("reader-page")
      .getAttribute("data-start");
    await page.evaluate(() => {
      for (let i = 0; i < 190; i++) (window as any).speechTest.finish();
    });
    await expect(page.getByTestId("reader-page")).not.toHaveAttribute(
      "data-start",
      before!,
    );
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    const spoken = (await speechCalls(page)).length;
    await page
      .getByRole("button", { name: "読み上げを停止", exact: true })
      .click();
    await page.evaluate(() => (window as any).speechTest.staleEnd());
    expect(await speechCalls(page)).toHaveLength(spoken);
    await expect(page.locator(".reader-speech")).toHaveAttribute(
      "data-status",
      "idle",
    );
    expect(errors).toEqual([]);
  });
}

test("voice discovery, preferences, sentence following, manual navigation and completion", async ({
  page,
}) => {
  await setup(page, {}, { voicesInitiallyEmpty: true });
  await page
    .getByRole("button", { name: "読み上げ設定を開く", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "読み上げ設定", exact: true });
  await expect(panel).toBeFocused();
  await expect(page.locator("#speech-voice option")).toHaveCount(1);
  await page.evaluate(() => (window as any).speechTest.loadVoices());
  await expect(page.locator("#speech-voice option")).toHaveCount(3);
  await page.getByLabel("音声", { exact: true }).selectOption("en-test");
  await page.getByLabel("読み上げ速度", { exact: true }).fill("1.4");
  await panel
    .getByRole("button", { name: "ここから読み上げる", exact: true })
    .click();
  expect((await speechCalls(page))[0]).toMatchObject({
    voice: "en-test",
    lang: "en-US",
    rate: 1.4,
  });
  await page.getByLabel("読み上げ速度", { exact: true }).fill("1.8");
  await finish(page);
  expect((await speechCalls(page))[1].rate).toBe(1.8);
  await panel.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "読み上げ設定を開く" }),
  ).toBeFocused();
  const before = await page
    .getByTestId("reader-page")
    .getAttribute("data-start");
  await page.evaluate(() => {
    for (let i = 0; i < 130; i++) (window as any).speechTest.finish();
  });
  await expect(page.getByTestId("reader-page")).not.toHaveAttribute(
    "data-start",
    before!,
  );
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page.getByRole("button", { name: "前のページ", exact: true }).click();
  await expect(page.locator(".reader-speech")).toHaveAttribute(
    "data-status",
    "idle",
  );
  await page.getByRole("button", { name: "目次を開く" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "終わり", exact: true })
    .click();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page
    .getByRole("button", { name: "ここから読み上げる", exact: true })
    .click();
  expect((await speechCalls(page)).at(-1).text).toBe("最後の文。");
  await finish(page);
  await expect(page.locator(".reader-speech")).toHaveAttribute(
    "data-status",
    "finished",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page.getByRole("button", { name: "読み上げ設定を開く" }).click();
  await expect(page.getByLabel("読み上げ速度", { exact: true })).toHaveValue(
    "1.8",
  );
  // The voice URI remains saved even before the asynchronous voice list arrives.
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("aozora-stone-reader:v1:settings")!)
          .speechVoiceURI,
    ),
  ).toBe("en-test");
});

test("errors are retryable and leaving the document cancels speech", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setup(page);
  const start = page.getByRole("button", {
    name: "ここから読み上げる",
    exact: true,
  });
  await start.click();
  await page.evaluate(() => (window as any).speechTest.fail("not-allowed"));
  await expect(page.getByRole("alert")).toContainText("再生ボタン");
  await start.click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect(page.locator(".reader-speech")).toHaveAttribute(
    "data-status",
    "idle",
  );
  await start.click();
  await page.getByRole("link", { name: "本棚へ", exact: true }).click();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).speechTest.calls.at(-1).method),
  ).toBe("cancel");
  expect(errors).toEqual([]);
});

test("Web novels use the same speech controls in horizontal CSS mode", async ({
  page,
}) => {
  await setup(page, { renderingMode: "css", direction: "lrTb" });
  const url = "https://ncode.syosetu.com/n1234ab/1/";
  await page.route("**/__web-novel?**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        url,
        html: '<!doctype html><html><body><p class="novel_title">風の試作</p><p class="p-novel__subtitle-episode">第一話</p><div class="p-novel__author">試作作者</div><div class="p-novel__text js-novel-text"><p><ruby>風<rt>かぜ</rt></ruby>と光が来た。</p><p>次の文。</p></div></body></html>',
      },
    }),
  );
  await page.goto(`/#/web/${encodeURIComponent(url)}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("reader")).toHaveAttribute(
    "data-engine",
    "css",
  );
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page
    .getByRole("button", { name: "ここから読み上げる", exact: true })
    .click();
  expect((await speechCalls(page))[0].text).toBe("かぜと光が来た。");
  await finish(page);
  expect((await speechCalls(page))[1].text).toBe("次の文。");
});

test("unsupported browsers explain why speech is unavailable", async ({
  page,
}) => {
  await setup(page, {}, { supported: false });
  await expect(
    page.getByRole("button", { name: "ここから読み上げる", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "読み上げ設定を開く" }).click();
  await expect(
    page.getByRole("region", { name: "読み上げ設定" }),
  ).toContainText("このブラウザは読み上げに対応していません");
});

test.describe("narrow screen", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test("speech controls and settings fit a 320px screen", async ({ page }) => {
    await setup(page, { viewMode: "scroll" });
    await page
      .getByRole("button", { name: "ここから読み上げる", exact: true })
      .click();
    const viewportBefore = await page
      .getByTestId("reader-viewport")
      .boundingBox();
    await page.getByRole("button", { name: "読み上げ設定を開く" }).click();
    const bounds = await page
      .getByRole("region", { name: "読み上げ設定" })
      .boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(await page.getByTestId("reader-viewport").boundingBox()).toEqual(
      viewportBefore,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await page.screenshot({
      path: test.info().outputPath("speech-controls.png"),
    });
  });
});
