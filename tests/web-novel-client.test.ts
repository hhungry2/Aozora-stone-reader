import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const parser = vi.hoisted(() => ({
  parse: vi.fn((html: string, url: string) => {
    const parsed = new URL(url);
    const kakuyomu = parsed.hostname === "kakuyomu.jp";
    const segments = parsed.pathname.split("/").filter(Boolean);
    return {
      info: {
        site: kakuyomu ? "kakuyomu" : "narou",
        siteName: kakuyomu ? "カクヨム" : "小説家になろう",
        url,
        workUrl: kakuyomu
          ? `${parsed.origin}/works/${segments[1]}`
          : `${parsed.origin}/${segments[0]}/`,
        title: `作品${segments[kakuyomu ? 1 : 0]}`,
        author: "作者",
        description: "紹介",
        episodeTitle: "第一話",
        episodes: [],
      },
      book: { blocks: [{ text: html }] },
    };
  }),
}));

vi.mock("../src/lib/web-novel", () => ({
  normalizeWebNovelUrl(input: string) {
    const url = new URL(input.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !["ncode.syosetu.com", "kakuyomu.jp"].includes(url.hostname) ||
      !/^\/(?:n\d+[a-z]+(?:\/\d+)?\/?|works\/\d+(?:\/episodes\/\d+)?\/?)$/.test(
        url.pathname,
      )
    ) {
      throw new Error("対応する作品のURLを入力してください。");
    }
    url.search = "";
    url.hash = "";
    if (url.hostname === "ncode.syosetu.com" && !url.pathname.endsWith("/")) {
      url.pathname += "/";
    }
    return url.href;
  },
  parseWebNovel: parser.parse,
}));

const PROXY_KEY = "aozora-stone-reader:v1:web-novel-proxy";
const RECENT_KEY = "aozora-stone-reader:v1:web-novel-recent";
const PROXY = "https://script.google.com/macros/s/example/exec";
const novel = (id = 1234, episode = 1) =>
  `https://ncode.syosetu.com/n${id}ab/${episode}/`;

class MemoryStorage {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

let storage: MemoryStorage;
let client: typeof import("../src/lib/web-novel-client");
let fetchMock: ReturnType<typeof vi.fn>;

function successful(url = novel(), html = "<p>本文</p>") {
  return new Response(JSON.stringify({ ok: true, url, html }), {
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_WEB_NOVEL_PROXY_URL", "");
  storage = new MemoryStorage();
  vi.stubGlobal("window", {
    localStorage: storage,
    location: { origin: "http://127.0.0.1:4173" },
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  parser.parse.mockClear();
  client = await import("../src/lib/web-novel-client");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("web novel proxy settings", () => {
  it("requires a configured proxy in production and explains how to supply it", async () => {
    expect(client.getWebNovelProxy()).toBe("");
    await expect(client.fetchWebNovel(novel())).rejects.toMatchObject({
      code: "proxy-required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the same-origin adapter only in development", () => {
    vi.stubEnv("DEV", true);
    expect(client.getWebNovelProxy()).toBe("http://127.0.0.1:4173/__web-novel");
    vi.stubEnv("DEV", false);
    expect(client.getWebNovelProxy()).toBe("");
  });

  it("prefers saved settings, falls back to the build setting and clears a saved override", () => {
    vi.stubEnv("VITE_WEB_NOVEL_PROXY_URL", "https://proxy.example/exec");
    expect(client.getWebNovelProxy()).toBe("https://proxy.example/exec");
    client.saveWebNovelProxy(` ${PROXY} `);
    expect(client.getWebNovelProxy()).toBe(PROXY);
    expect(storage.getItem(PROXY_KEY)).toBe(PROXY);
    client.saveWebNovelProxy("");
    expect(storage.getItem(PROXY_KEY)).toBeNull();
    expect(client.getWebNovelProxy()).toBe("https://proxy.example/exec");
  });

  it.each([
    "http://proxy.example/exec",
    "http://127.0.0.1:8888/exec",
    "https://user:password@proxy.example/exec",
    "https://proxy.example/exec#fragment",
    "https://proxy.example/exec#",
    "javascript:alert(1)",
    "/__web-novel",
    "file:///tmp/proxy",
  ])("rejects unsafe proxy settings: %s", (url) => {
    expect(() => client.saveWebNovelProxy(url)).toThrow(
      client.WebNovelClientError,
    );
    expect(storage.getItem(PROXY_KEY)).toBeNull();
  });

  it("permits localhost HTTP for development but rejects other HTTP hosts", () => {
    vi.stubEnv("DEV", true);
    client.saveWebNovelProxy("http://localhost:8888/exec");
    expect(client.getWebNovelProxy()).toBe("http://localhost:8888/exec");
    expect(() => client.saveWebNovelProxy("http://192.168.1.1/exec")).toThrow();
  });

  it("ignores a corrupted stored URL and invalid environment URL", () => {
    storage.setItem(PROXY_KEY, "javascript:alert(1)");
    vi.stubEnv(
      "VITE_WEB_NOVEL_PROXY_URL",
      "https://user:password@proxy.example/exec",
    );
    expect(client.getWebNovelProxy()).toBe("");
    vi.stubEnv("VITE_WEB_NOVEL_PROXY_URL", PROXY);
    expect(client.getWebNovelProxy()).toBe(PROXY);
  });

  it("keeps settings usable when browser storage is denied", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
    expect(client.getWebNovelProxy()).toBe("");
    client.saveWebNovelProxy(PROXY);
    expect(client.getWebNovelProxy()).toBe(PROXY);
    client.saveWebNovelProxy("");
    expect(client.getWebNovelProxy()).toBe("");
  });
});

describe("web novel retrieval", () => {
  beforeEach(() => client.saveWebNovelProxy(PROXY));

  it("sends a canonical URL and charset without cookies, then passes HTML only to the parser", async () => {
    const html = '<p>本文</p><script>alert("untrusted")</script>';
    fetchMock.mockResolvedValue(successful(novel(), html));
    const page = await client.fetchWebNovel(`${novel()}?tracking=1#body`);
    const [endpoint, options] = fetchMock.mock.calls[0];
    const url = new URL(endpoint);
    expect(url.origin + url.pathname).toBe(PROXY);
    expect(url.searchParams.get("url")).toBe(novel());
    expect(url.searchParams.get("charset")).toBe("UTF-8");
    expect(options).toMatchObject({
      method: "GET",
      credentials: "omit",
      cache: "no-store",
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(parser.parse).toHaveBeenCalledWith(html, novel());
    expect(page.info.url).toBe(novel());
    expect(storage.getItem(RECENT_KEY)).not.toContain("untrusted");
    expect([...storage.items.keys()]).toEqual([PROXY_KEY, RECENT_KEY]);
  });

  it.each([403, 404, 429, 500])(
    "explains HTTP %s and does not parse or save a failed response",
    async (status) => {
      fetchMock.mockResolvedValue(new Response("server error", { status }));
      await expect(client.fetchWebNovel(novel())).rejects.toMatchObject({
        code: "http-error",
        message: expect.stringContaining(String(status)),
      });
      expect(parser.parse).not.toHaveBeenCalled();
      expect(client.getRecentWebNovels()).toEqual([]);
    },
  );

  it("preserves a proxy error and explains an upstream status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "作品が非公開です" })),
    );
    await expect(client.fetchWebNovel(novel())).rejects.toMatchObject({
      code: "proxy-error",
      message: "作品が非公開です",
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, error: "Forbidden", status: 403 }),
      ),
    );
    await expect(client.fetchWebNovel(novel())).rejects.toThrow("403");
  });

  it("explains a Google login/HTML response rather than attempting to parse it as a novel", async () => {
    fetchMock.mockResolvedValue(
      new Response("<!doctype html><title>Sign in</title>"),
    );
    await expect(client.fetchWebNovel(novel())).rejects.toMatchObject({
      code: "invalid-response",
      message: expect.stringContaining("全員"),
    });
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { ok: true, url: novel() },
    { ok: true, url: novel(), html: " " },
  ])("rejects a malformed success response", async (payload) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(client.fetchWebNovel(novel())).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it.each([
    "https://accounts.google.com/",
    novel(9999),
    "https://kakuyomu.jp/works/123",
  ])("rejects a redirect to %s", async (url) => {
    fetchMock.mockResolvedValue(successful(url));
    await expect(client.fetchWebNovel(novel())).rejects.toMatchObject({
      code: "redirect-rejected",
    });
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it("accepts a final canonical URL for another episode of the same work", async () => {
    fetchMock.mockResolvedValue(successful(novel(1234, 2)));
    expect((await client.fetchWebNovel(novel())).info.url).toBe(novel(1234, 2));
    expect(client.getRecentWebNovels()[0].url).toBe(novel(1234, 2));
  });

  it("rejects inconsistent parser metadata", async () => {
    fetchMock.mockResolvedValue(successful());
    const original = parser.parse.getMockImplementation()!;
    parser.parse.mockImplementationOnce((html, url) => {
      const page = original(html, url);
      return { ...page, info: { ...page.info, url: novel(5555) } };
    });
    await expect(client.fetchWebNovel(novel())).rejects.toMatchObject({
      code: "invalid-response",
    });
    expect(client.getRecentWebNovels()).toEqual([]);
  });

  it("explains network failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(client.fetchWebNovel(novel())).rejects.toMatchObject({
      code: "network-error",
    });
  });

  it("does not start an already aborted request", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      client.fetchWebNovel(novel(), { signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an active request without writing recent entries or caching late responses", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const abort = new AbortController();
    const pending = client.fetchWebNovel(novel(), { signal: abort.signal });
    const rejection = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    abort.abort();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    resolve(successful());
    await rejection;
    expect(client.getRecentWebNovels()).toEqual([]);
    fetchMock.mockResolvedValueOnce(successful());
    await client.fetchWebNovel(novel());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("times out after 45 seconds and releases its timer", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const pending = client.fetchWebNovel(novel());
    const rejection = expect(pending).rejects.toMatchObject({
      code: "timeout",
      message: expect.stringContaining("45秒"),
    });
    await vi.advanceTimersByTimeAsync(45_000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    expect(client.getRecentWebNovels()).toEqual([]);
  });
});

describe("temporary cache and recent metadata", () => {
  beforeEach(() => {
    client.saveWebNovelProxy(PROXY);
    fetchMock.mockImplementation((endpoint) =>
      successful(new URL(endpoint).searchParams.get("url")!),
    );
  });

  it("keeps four least-recently-used pages for one minute, with explicit reload support", async () => {
    vi.useFakeTimers();
    await client.fetchWebNovel(novel(1));
    await client.fetchWebNovel(novel(2));
    await client.fetchWebNovel(novel(3));
    await client.fetchWebNovel(novel(4));
    await client.fetchWebNovel(novel(1));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await client.fetchWebNovel(novel(5));
    await client.fetchWebNovel(novel(2));
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await client.fetchWebNovel(novel(1), { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(60_001);
    await client.fetchWebNovel(novel(1));
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("invalidates cached text when changing or clearing the proxy", async () => {
    await client.fetchWebNovel(novel());
    client.saveWebNovelProxy("https://proxy.example/exec");
    await client.fetchWebNovel(novel());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    client.clearWebNovelCache();
    await client.fetchWebNovel(novel());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("deletes the saved proxy and recent entries in memory and storage while preserving another app's data", async () => {
    storage.setItem("another-app:setting", "keep");
    await client.fetchWebNovel(novel());
    expect(client.getRecentWebNovels()).toHaveLength(1);
    expect(client.getWebNovelProxy()).toBe(PROXY);

    client.clearWebNovelData();

    expect(client.getRecentWebNovels()).toEqual([]);
    expect(client.getWebNovelProxy()).toBe("");
    expect(storage.getItem(PROXY_KEY)).toBeNull();
    expect(storage.getItem(RECENT_KEY)).toBeNull();
    expect(storage.getItem("another-app:setting")).toBe("keep");
    client.saveWebNovelProxy(PROXY);
    await client.fetchWebNovel(novel());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not restore cache or recent metadata from a request cleared while in flight", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pending = client.fetchWebNovel(novel());
    client.clearWebNovelCache();
    resolve(successful());
    await pending;
    expect(client.getRecentWebNovels()).toEqual([]);
    await client.fetchWebNovel(novel());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the newer forced response if an older request finishes later", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const older = client.fetchWebNovel(novel());
    fetchMock.mockResolvedValueOnce(successful(novel(), "newer"));
    const newer = await client.fetchWebNovel(novel(), { force: true });
    resolve(successful(novel(), "older"));
    await older;
    expect(await client.fetchWebNovel(novel())).toBe(newer);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("persists only twelve recent metadata entries and moves a reopened URL to the front", async () => {
    vi.useFakeTimers();
    for (let id = 1; id <= 14; id += 1) {
      await client.fetchWebNovel(novel(id));
      await vi.advanceTimersByTimeAsync(1000);
    }
    let recent = client.getRecentWebNovels();
    expect(recent).toHaveLength(12);
    expect(recent[0].url).toBe(novel(14));
    expect(recent.at(-1)?.url).toBe(novel(3));
    await client.fetchWebNovel(novel(5));
    recent = client.getRecentWebNovels();
    expect(recent).toHaveLength(12);
    expect(recent[0].url).toBe(novel(5));
    expect(recent.filter((item) => item.url === novel(5))).toHaveLength(1);
    expect(Object.keys(recent[0]).sort()).toEqual([
      "author",
      "openedAt",
      "siteName",
      "title",
      "url",
    ]);
    expect(storage.getItem(RECENT_KEY)).not.toContain("blocks");
    expect(storage.getItem(RECENT_KEY)).not.toContain("<p>");
  });

  it("safely drops malformed JSON, invalid URLs, dates and duplicate recent entries", () => {
    storage.setItem(RECENT_KEY, "not json");
    expect(client.getRecentWebNovels()).toEqual([]);
    storage.setItem(RECENT_KEY, JSON.stringify({ url: novel() }));
    expect(client.getRecentWebNovels()).toEqual([]);
    const item = {
      url: novel(),
      title: "作品",
      author: "作者",
      siteName: "小説家になろう",
      openedAt: "2026-10-12T01:00:00.000Z",
    };
    storage.setItem(
      RECENT_KEY,
      JSON.stringify([
        null,
        { ...item, url: "javascript:alert(1)" },
        { ...item, openedAt: "not a date" },
        { ...item, title: {} },
        { ...item, url: novel(2), openedAt: "2026-10-11T01:00:00.000Z" },
        item,
        { ...item, url: `${novel()}?duplicate=1` },
      ]),
    );
    expect(client.getRecentWebNovels().map((entry) => entry.url)).toEqual([
      novel(),
      novel(2),
    ]);
  });

  it("keeps recent entries available for the session when writes are denied", async () => {
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await client.fetchWebNovel(novel());
    expect(client.getRecentWebNovels()).toMatchObject([
      { url: novel(), title: "作品n1234ab" },
    ]);
    expect(storage.getItem(RECENT_KEY)).toBeNull();
  });
});
