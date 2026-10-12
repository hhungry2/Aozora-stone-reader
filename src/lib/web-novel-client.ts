import { STORAGE_PREFIX } from "./state";
import { normalizeWebNovelUrl, parseWebNovel } from "./web-novel";
import type { WebNovelPage } from "./web-novel";

export interface RecentWebNovel {
  url: string;
  title: string;
  author: string;
  siteName: string;
  openedAt: string;
}

export type WebNovelClientErrorCode =
  | "proxy-required"
  | "invalid-proxy"
  | "http-error"
  | "proxy-error"
  | "invalid-response"
  | "redirect-rejected"
  | "network-error"
  | "timeout";

export class WebNovelClientError extends Error {
  readonly code: WebNovelClientErrorCode;
  constructor(code: WebNovelClientErrorCode, message: string) {
    super(message);
    this.name = "WebNovelClientError";
    this.code = code;
  }
}

const PROXY_KEY = `${STORAGE_PREFIX}web-novel-proxy`;
const RECENT_KEY = `${STORAGE_PREFIX}web-novel-recent`;
const RECENT_LIMIT = 12;
const CACHE_LIMIT = 4;
const CACHE_TTL = 60_000;
const TIMEOUT = 45_000;
// A failed storage write must still take effect for this browsing session.
const storageMemory = new Map<string, string | null>();
const cache = new Map<string, { page: WebNovelPage; fetchedAt: number }>();
const requestRevisions = new Map<string, number>();
let cacheGeneration = 0;
let requestRevision = 0;

function readStorage(key: string): string | null {
  if (storageMemory.has(key)) return storageMemory.get(key) ?? null;
  try {
    return typeof window === "undefined"
      ? null
      : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  storageMemory.set(key, value);
  try {
    if (typeof window === "undefined") return;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Metadata and the proxy setting remain usable without persistent storage.
  }
}

function normalizeProxy(input: string): string {
  const value = input.trim();
  if (!value) return "";
  try {
    if (value.length > 2048) throw new Error();
    const url = new URL(value);
    const localHttp =
      import.meta.env.DEV &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username ||
      url.password ||
      url.href.includes("#")
    ) {
      throw new Error();
    }
    return url.href;
  } catch {
    throw new WebNovelClientError(
      "invalid-proxy",
      "中継サーバーにはHTTPSのURLを入力してください。Google Apps Scriptは、デプロイしたウェブアプリの「/exec」で終わるURLを使用します。認証情報や「#」は含められません。",
    );
  }
}

export function getWebNovelProxy(): string {
  for (const input of [
    readStorage(PROXY_KEY),
    import.meta.env.VITE_WEB_NOVEL_PROXY_URL,
  ]) {
    if (typeof input !== "string" || !input.trim()) continue;
    try {
      return normalizeProxy(input);
    } catch {
      // Ignore old or manually edited invalid settings, then try the fallback.
    }
  }
  if (import.meta.env.DEV && typeof window !== "undefined") {
    try {
      return new URL("/__web-novel", window.location.origin).href;
    } catch {
      return "";
    }
  }
  return "";
}

export function saveWebNovelProxy(input: string): void {
  const proxy = normalizeProxy(input);
  writeStorage(PROXY_KEY, proxy || null);
  clearWebNovelCache();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRecent(value: unknown): RecentWebNovel | null {
  if (!isObject(value)) return null;
  if (
    typeof value.url !== "string" ||
    value.url.length > 2048 ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 1000 ||
    typeof value.author !== "string" ||
    value.author.length > 500 ||
    typeof value.siteName !== "string" ||
    value.siteName.length > 100 ||
    typeof value.openedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value.openedAt) ||
    !Number.isFinite(Date.parse(value.openedAt))
  ) {
    return null;
  }
  try {
    return {
      url: normalizeWebNovelUrl(value.url),
      title: value.title,
      author: value.author,
      siteName: value.siteName,
      openedAt: value.openedAt,
    };
  } catch {
    return null;
  }
}

export function getRecentWebNovels(): RecentWebNovel[] {
  try {
    const raw = readStorage(RECENT_KEY);
    if (!raw || raw.length > 100_000) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    const candidates = values
      .map(validRecent)
      .filter((item): item is RecentWebNovel => item !== null)
      .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
    const result: RecentWebNovel[] = [];
    const seen = new Set<string>();
    for (const recent of candidates) {
      if (seen.has(recent.url)) continue;
      seen.add(recent.url);
      result.push(recent);
      if (result.length === RECENT_LIMIT) break;
    }
    return result;
  } catch {
    return [];
  }
}

function saveRecent(page: WebNovelPage): void {
  const recent = validRecent({
    url: page.info.url,
    title: page.info.title,
    author: page.info.author,
    siteName: page.info.siteName,
    openedAt: new Date().toISOString(),
  });
  if (!recent) return;
  const items = [
    recent,
    ...getRecentWebNovels().filter((item) => item.url !== recent.url),
  ].slice(0, RECENT_LIMIT);
  writeStorage(RECENT_KEY, JSON.stringify(items));
}

export function clearWebNovelCache(): void {
  cacheGeneration += 1;
  cache.clear();
  requestRevisions.clear();
}

export function clearWebNovelData(): void {
  clearWebNovelCache();
  writeStorage(PROXY_KEY, null);
  writeStorage(RECENT_KEY, null);
}

function abortError(): DOMException {
  return new DOMException("読み込みを中止しました。", "AbortError");
}

function workIdentity(canonical: string): string {
  const url = new URL(canonical);
  const parts = url.pathname.split("/").filter(Boolean);
  return `${url.hostname}/${parts.slice(0, url.hostname === "kakuyomu.jp" ? 2 : 1).join("/")}`;
}

function httpMessage(status: number): string {
  if (status === 403) {
    return "本文の取得が拒否されました（403）。公開範囲や中継サーバーのアクセス設定を確認してください。";
  }
  if (status === 404) {
    return "指定された作品または中継サーバーが見つかりません（404）。URLを確認してください。";
  }
  if (status === 429) {
    return "取得回数が上限に達しました（429）。しばらく待ってから読み込み直してください。";
  }
  return `本文を取得できませんでした（HTTP ${status}）。時間をおいて読み込み直してください。`;
}

function invalidResponseMessage(html: boolean): string {
  return html
    ? "中継サーバーから本文データの代わりにHTMLページが返りました。Google Apps Scriptのウェブアプリを「全員」に公開し、「/exec」で終わるURLを設定してください。ログインが必要なページは取得できません。"
    : "中継サーバーの応答形式が正しくありません。付属のGoogle Apps Scriptをデプロイし直して、設定URLを確認してください。";
}

export async function fetchWebNovel(
  input: string,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<WebNovelPage> {
  const canonical = normalizeWebNovelUrl(input);
  if (options.signal?.aborted) throw abortError();
  const proxy = getWebNovelProxy();
  if (!proxy) {
    throw new WebNovelClientError(
      "proxy-required",
      "Web小説を開くには中継サーバーの設定が必要です。Google Apps Scriptをウェブアプリとして公開し、そのURLを設定してください。",
    );
  }
  const key = `${proxy}\n${canonical}`;
  const hit = cache.get(key);
  if (!options.force && hit && Date.now() - hit.fetchedAt < CACHE_TTL) {
    cache.delete(key);
    cache.set(key, hit);
    saveRecent(hit.page);
    return hit.page;
  }
  if (hit && Date.now() - hit.fetchedAt >= CACHE_TTL) cache.delete(key);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT);
  const generation = cacheGeneration;
  const revision = ++requestRevision;
  requestRevisions.set(key, revision);
  try {
    const endpoint = new URL(proxy);
    endpoint.searchParams.set("url", canonical);
    endpoint.searchParams.set("charset", "UTF-8");
    const response = await fetch(endpoint.href, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw abortError();
    if (!response.ok) {
      throw new WebNovelClientError("http-error", httpMessage(response.status));
    }
    const text = await response.text();
    if (controller.signal.aborted) throw abortError();
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      throw new WebNovelClientError(
        "invalid-response",
        invalidResponseMessage(/^\s*</.test(text)),
      );
    }
    if (!isObject(result)) {
      throw new WebNovelClientError(
        "invalid-response",
        invalidResponseMessage(false),
      );
    }
    if (result.ok === false) {
      const status =
        typeof result.status === "number" ? result.status : undefined;
      const detail =
        typeof result.error === "string"
          ? result.error.trim().slice(0, 500)
          : "";
      throw new WebNovelClientError(
        "proxy-error",
        status
          ? httpMessage(status)
          : detail ||
              "中継サーバーで本文を取得できませんでした。URLと公開範囲を確認してください。",
      );
    }
    if (
      result.ok !== true ||
      typeof result.url !== "string" ||
      typeof result.html !== "string" ||
      !result.html.trim() ||
      result.html.length > 5_000_000
    ) {
      throw new WebNovelClientError(
        "invalid-response",
        invalidResponseMessage(false),
      );
    }
    let finalUrl: string;
    try {
      finalUrl = normalizeWebNovelUrl(result.url);
    } catch {
      throw new WebNovelClientError(
        "redirect-rejected",
        "本文の取得先が対応する作品ページから変更されました。元のサイトで作品の公開状態を確認してください。",
      );
    }
    if (workIdentity(canonical) !== workIdentity(finalUrl)) {
      throw new WebNovelClientError(
        "redirect-rejected",
        "本文の取得先が別の作品に変更されました。元のサイトでURLを確認してください。",
      );
    }
    // The parser extracts structured text; the fetched HTML is never executed.
    const page = parseWebNovel(result.html, finalUrl);
    if (
      page.info.url !== finalUrl ||
      workIdentity(page.info.workUrl) !== workIdentity(finalUrl)
    ) {
      throw new WebNovelClientError(
        "invalid-response",
        "読み込んだ作品情報と取得URLが一致しません。元のサイトで作品のURLを確認してください。",
      );
    }
    if (controller.signal.aborted) throw abortError();
    if (
      generation === cacheGeneration &&
      requestRevisions.get(key) === revision
    ) {
      cache.delete(key);
      cache.set(key, { page, fetchedAt: Date.now() });
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      saveRecent(page);
    }
    return page;
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    if (timedOut) {
      throw new WebNovelClientError(
        "timeout",
        "本文の取得に45秒以上かかりました。中継サーバーの設定や接続を確認し、もう一度お試しください。",
      );
    }
    if (error instanceof TypeError) {
      throw new WebNovelClientError(
        "network-error",
        "中継サーバーに接続できませんでした。インターネット接続、ウェブアプリの公開設定、設定URLを確認してください。",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    if (requestRevisions.get(key) === revision) requestRevisions.delete(key);
  }
}
