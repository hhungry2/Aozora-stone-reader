import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  createWebNovelMiddleware,
  createWebNovelRelay,
  normalizeWebNovelUrl,
} from "../server/web-novel-proxy";

const NAROU = "https://ncode.syosetu.com/n1234ab/";
const KAKUYOMU = "https://kakuyomu.jp/works/123456789";
const htmlResponse = (html = "<html><body>本文</body></html>", headers: Record<string, string> = {}) =>
  new Response(html, { headers: { "content-type": "text/html; charset=UTF-8", ...headers } });

interface GasResponse {
  getResponseCode: () => number;
  getAllHeaders: () => Record<string, string>;
  getBlob: () => { getBytes: () => Buffer };
  getContentText: (charset: string) => string;
}

function gasResponse(html = "<html>本文</html>", status = 200, headers: Record<string, string> = {}): GasResponse {
  return {
    getResponseCode: () => status,
    getAllHeaders: () => ({ "Content-Type": "text/html; charset=UTF-8", ...headers }),
    getBlob: () => ({ getBytes: () => Buffer.from(html) }),
    getContentText: () => html,
  };
}

function gasScript(fetchImpl = vi.fn(() => gasResponse())) {
  const entries = new Map<string, string>();
  const cache = { get: (key: string) => entries.get(key), put: vi.fn((key: string, value: string, _seconds: number) => entries.set(key, value)) };
  const context: Record<string, unknown> = {
    UrlFetchApp: { fetch: fetchImpl },
    CacheService: { getScriptCache: () => cache },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (algorithm: string, value: string) => createHash(algorithm).update(value).digest(),
      base64EncodeWebSafe: (value: Buffer) => value.toString("base64url"),
      newBlob: (value: string) => ({ getBytes: () => Buffer.from(value) }),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (value: string) => ({ setMimeType: () => JSON.parse(value) }),
    },
  };
  runInNewContext(readFileSync(new URL("../server/google-apps-script/Code.gs", import.meta.url), "utf8"), context);
  return {
    normalize: context.normalizeWebNovelUrl_ as (input: string) => string,
    resolveRedirect: context.resolveWebNovelRedirect_ as (location: string, current: string) => string,
    get: context.doGet as (e: { parameter: Record<string, string>; parameters?: Record<string, string[]> }) => {
      ok: boolean; url?: string; html?: string; error?: string;
    },
    fetchImpl,
    cache,
  };
}

const validUrls = [
  [NAROU, NAROU],
  [" HTTPS://NCODE.SYOSETU.COM/N1234AB#section ", NAROU],
  ["https://ncode.syosetu.com/n1234ab/0002", `${NAROU}2/`],
  ["https://ncode.syosetu.com/n1234ab/2/?cookie=request#footer", `${NAROU}2/`],
  [`${NAROU}?p=002&tracking=yes#footer`, `${NAROU}?p=2`],
  [`${NAROU}?tracking=yes`, NAROU],
  [`${NAROU}?%70=3`, `${NAROU}?p=3`],
  [KAKUYOMU, KAKUYOMU],
  [`${KAKUYOMU}/?tracking=yes#footer`, KAKUYOMU],
  [`${KAKUYOMU}/episodes/987654321/`, `${KAKUYOMU}/episodes/987654321`],
];
const invalidUrls = [
  "http://ncode.syosetu.com/n1234ab/",
  "https://ncode.syosetu.com:443/n1234ab/",
  "https://user:password@ncode.syosetu.com/n1234ab/",
  "https://ncode.syosetu.com.evil.example/n1234ab/",
  "https://ncode.syosetu.com./n1234ab/",
  "https://127.0.0.1/n1234ab/",
  "https://syosetu.com/n1234ab/",
  "https://novel18.syosetu.com/n1234ab/",
  "https://ncode.syosetu.com/n1234ab/0/",
  "https://ncode.syosetu.com/n1234ab/1e2/",
  "https://ncode.syosetu.com/n1234ab/../n5678cd/",
  "https://ncode.syosetu.com/n1234ab/%2e%2e/n5678cd/",
  "https://ncode.syosetu.com\\@evil.example/n1234ab/",
  "https://ncode.syosetu.com/n1234ab/?tracking=\\path",
  "https://kakuyomu.jp/works/123#\\path",
  "https://ncode.syosetu.com/n1234ab/?tracking=one\ntwo",
  `${NAROU}?p=0`,
  `${NAROU}?p=-1`,
  `${NAROU}?p=1&p=2`,
  `${NAROU}?p=2&%70=3`,
  "https://kakuyomu.jp:443/works/123",
  "https://kakuyomu.jp/works/abc/",
  "https://kakuyomu.jp/works/123/episodes/xyz",
  "https://kakuyomu.jp/users/example",
  "javascript:alert(1)",
];

describe("public web-novel URL allowlist", () => {
  const gas = gasScript();
  it.each(validUrls)("normalizes %s consistently in Node and Apps Script", (input, expected) => {
    expect(normalizeWebNovelUrl(input)).toBe(expected);
    expect(gas.normalize(input)).toBe(expected);
  });
  it.each(invalidUrls)("rejects %s in Node and Apps Script", (input) => {
    expect(() => normalizeWebNovelUrl(input)).toThrow();
    expect(() => gas.normalize(input)).toThrow();
  });
});

describe("Node HTML relay", () => {
  it("fetches anonymous HTML and caches concurrent equivalent URLs for 30 seconds", async () => {
    let time = 0;
    const fetchImpl = vi.fn(async () => htmlResponse());
    const relay = createWebNovelRelay({ fetchImpl, now: () => time });
    const results = await Promise.all([relay(NAROU), relay(`${NAROU}?tracking=1`)]);
    expect(results[0]).toEqual({ ok: true, url: NAROU, html: "<html><body>本文</body></html>" });
    expect(results[1]).toEqual(results[0]);
    await relay(NAROU);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(NAROU, expect.objectContaining({
      redirect: "manual", credentials: "omit", headers: { Accept: "text/html,application/xhtml+xml" },
    }));
    time = 30_001;
    await relay(NAROU);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("revalidates relative redirects and returns the canonical final URL", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "2/?tracking=yes" } }))
      .mockResolvedValueOnce(htmlResponse());
    const result = await createWebNovelRelay({ fetchImpl })(NAROU);
    expect(result.url).toBe(`${NAROU}2/`);
    expect(fetchImpl.mock.calls[1][0]).toBe(`${NAROU}2/`);
  });

  it.each([
    "https://127.0.0.1/private", "https://ncode.syosetu.com.evil.example/n1234ab/",
    "http://ncode.syosetu.com/n1234ab/", "https://ncode.syosetu.com:443/n1234ab/",
    "https://user@ncode.syosetu.com/n1234ab/", "https://ncode.syosetu.com/login/",
  ])("rejects an unsafe redirect before requesting %s", async (location) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
    await expect(createWebNovelRelay({ fetchImpl })(NAROU)).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("allows at most three redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: NAROU } }));
    await expect(createWebNovelRelay({ fetchImpl })(NAROU)).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    [new Response("missing", { status: 404 }), 404],
    [new Response("denied", { status: 403 }), 502],
    [new Response("{}", { headers: { "content-type": "application/json" } }), 502],
    [htmlResponse("<html>小</html>", { "content-length": "1000" }), 413],
    [htmlResponse("あ".repeat(100)), 413],
  ])("rejects an upstream error, non-HTML or oversized response", async (response, status) => {
    const fetchImpl = vi.fn(async () => response as Response);
    await expect(createWebNovelRelay({ fetchImpl, maxBytes: 64 })(NAROU)).rejects.toMatchObject({ status });
  });

  it("does not cache a failed request and hides transport details", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("private transport detail"))
      .mockResolvedValueOnce(htmlResponse());
    const relay = createWebNovelRelay({ fetchImpl });
    await expect(relay(NAROU)).rejects.toThrow("本文を取得できませんでした。");
    expect((await relay(NAROU)).ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports a timeout without exposing the upstream exception", async () => {
    const fetchImpl = vi.fn(async () => { throw new DOMException("upstream timeout", "TimeoutError"); });
    await expect(createWebNovelRelay({ fetchImpl })(NAROU)).rejects.toThrow("取得に時間がかかっています。");
  });

  it("aborts a request when the configured deadline expires", async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    await expect(createWebNovelRelay({ fetchImpl, timeoutMs: 20 })(NAROU)).rejects.toThrow("取得に時間がかかっています。");
  });
});

describe("Vite relay middleware", () => {
  async function invoke(method: string, url: string) {
    const relay = vi.fn(async () => ({ ok: true as const, url: NAROU, html: "<html>本文</html>" }));
    const next = vi.fn();
    const headers: Record<string, string> = {};
    const response = { statusCode: 0, setHeader: (key: string, value: string) => { headers[key] = value; }, end: vi.fn() };
    await createWebNovelMiddleware(relay)({ method, url } as IncomingMessage, response as unknown as ServerResponse, next);
    return { relay, next, headers, status: response.statusCode, result: response.end.mock.calls[0]?.[0] ? JSON.parse(response.end.mock.calls[0][0]) : undefined };
  }

  it("returns the shared JSON result for GET", async () => {
    const result = await invoke("GET", `/__web-novel?url=${encodeURIComponent(NAROU)}&charset=UTF-8`);
    expect(result.status).toBe(200);
    expect(result.result).toMatchObject({ ok: true, url: NAROU });
    expect(result.headers["Cache-Control"]).toBe("no-store");
  });
  it.each([
    ["POST", `/__web-novel?url=${encodeURIComponent(NAROU)}`, 405],
    ["GET", "/__web-novel", 400],
    ["GET", "/__web-novel?url=x&url=y", 400],
    ["GET", `/__web-novel?url=${encodeURIComponent(NAROU)}&charset=Shift-JIS`, 400],
  ])("rejects method or malformed request before fetching", async (method, url, status) => {
    const result = await invoke(method, url);
    expect(result.status).toBe(status);
    expect(result.result.ok).toBe(false);
    expect(result.relay).not.toHaveBeenCalled();
  });
  it("passes other routes to Vite", async () => {
    const result = await invoke("GET", "/src/App.tsx");
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.relay).not.toHaveBeenCalled();
  });
});

describe("Apps Script HTML relay", () => {
  it("returns JSON and a short cache without using cookies or following unchecked redirects", () => {
    const gas = gasScript();
    const result = gas.get({ parameter: { url: NAROU, charset: "UTF-8" } });
    expect(result).toEqual({ ok: true, url: NAROU, html: "<html>本文</html>" });
    expect(gas.get({ parameter: { url: NAROU } })).toEqual(result);
    expect(gas.fetchImpl).toHaveBeenCalledTimes(1);
    expect(gas.fetchImpl).toHaveBeenCalledWith(NAROU, {
      method: "get", followRedirects: false, muteHttpExceptions: true, validateHttpsCertificates: true,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    expect(gas.cache.put.mock.calls[0][2]).toBe(30);
  });

  it.each([
    ["2/", `${NAROU}2/`],
    ["?p=2", `${NAROU}?p=2`],
    ["/n4567cd/", "https://ncode.syosetu.com/n4567cd/"],
    ["//kakuyomu.jp/works/123/", "https://kakuyomu.jp/works/123"],
    ["../n4567cd/", "https://ncode.syosetu.com/n4567cd/"],
  ])("resolves a supported redirect without a browser URL API", (location, expected) => {
    expect(gasScript().resolveRedirect(location, NAROU)).toBe(expected);
  });

  it("blocks an unsafe redirect before any second request", () => {
    const fetchImpl = vi.fn(() => gasResponse("", 302, { Location: "https://127.0.0.1/private" }));
    const result = gasScript(fetchImpl).get({ parameter: { url: NAROU } });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("転送");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops after three redirects", () => {
    const fetchImpl = vi.fn(() => gasResponse("", 302, { Location: NAROU }));
    expect(gasScript(fetchImpl).get({ parameter: { url: NAROU } }).ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("rejects a large body even without a content-length header", () => {
    const fetchImpl = vi.fn(() => gasResponse("あ".repeat(750_000)));
    const result = gasScript(fetchImpl).get({ parameter: { url: NAROU } });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("大きすぎる");
  });

  it("does not put long episodes into CacheService's 100 KB entries", () => {
    const gas = gasScript(vi.fn(() => gasResponse("あ".repeat(40_000))));
    expect(gas.get({ parameter: { url: NAROU } }).ok).toBe(true);
    expect(gas.cache.put).not.toHaveBeenCalled();
  });

  it("rejects unsupported input without requesting a page", () => {
    const gas = gasScript();
    expect(gas.get({ parameter: { url: "https://example.com" } }).ok).toBe(false);
    expect(gas.get({ parameter: { url: NAROU, charset: "Shift-JIS" } }).ok).toBe(false);
    expect(gas.get({ parameter: { url: NAROU }, parameters: { url: [NAROU, KAKUYOMU] } }).ok).toBe(false);
    expect(gas.fetchImpl).not.toHaveBeenCalled();
  });
});
