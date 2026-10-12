/**
 * HTML relay adapted from TxtMiruOnTheWeb/server/ActionScript.js.
 * Copyright (c) 2021 gearsns, MIT License.
 * https://github.com/gearsns/TxtMiruOnTheWeb (da2c63591aa9ac0db1d0823e8f5bfb962eeaef63)
 * Uses the same url/charset request convention; adds a strict public-page allowlist.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

export const MAX_WEB_NOVEL_BYTES = 2 * 1024 * 1024;
const INVALID_URL = "なろう・カクヨムの作品またはエピソードのURLを指定してください。";

export class WebNovelProxyError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "WebNovelProxyError";
  }
}

/** Keep this normalization in sync with server/google-apps-script/Code.gs. */
export function normalizeWebNovelUrl(input: string): string {
  const value = input.trim();
  if (/[\u0000-\u0020\u007f\\]/.test(value)) throw new WebNovelProxyError(INVALID_URL);
  const match = value.length <= 4096
    ? /^https:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?(?:#[\s\S]*)?$/i.exec(value)
    : null;
  if (!match) throw new WebNovelProxyError(INVALID_URL);
  const host = match[1].toLowerCase();
  const path = match[2] || "/";
  if (host === "ncode.syosetu.com") {
    const narou = /^\/(n[a-z0-9]+)(?:\/(\d+))?\/?$/i.exec(path);
    if (!narou) throw new WebNovelProxyError(INVALID_URL);
    const episode = narou[2]?.replace(/^0+/, "");
    if (narou[2] !== undefined && !episode) throw new WebNovelProxyError(INVALID_URL);
    let normalized = `https://${host}/${narou[1].toLowerCase()}/${episode ? `${episode}/` : ""}`;
    if (!episode && match[3]) {
      let page: string | undefined;
      for (const pair of match[3].split("&")) {
        let key: string;
        let entry: string;
        try {
          const separator = pair.indexOf("=");
          key = decodeURIComponent((separator < 0 ? pair : pair.slice(0, separator)).replace(/\+/g, " "));
          entry = decodeURIComponent((separator < 0 ? "" : pair.slice(separator + 1)).replace(/\+/g, " "));
        } catch {
          throw new WebNovelProxyError(INVALID_URL);
        }
        if (key !== "p") continue;
        if (page !== undefined || !/^\d+$/.test(entry)) throw new WebNovelProxyError(INVALID_URL);
        page = entry.replace(/^0+/, "");
        if (!page) throw new WebNovelProxyError(INVALID_URL);
      }
      if (page) normalized += `?p=${page}`;
    }
    return normalized;
  }
  if (host === "kakuyomu.jp" && /^\/works\/\d+(?:\/episodes\/\d+)?\/?$/.test(path)) {
    return `https://${host}${path.replace(/\/$/, "")}`;
  }
  throw new WebNovelProxyError(INVALID_URL);
}

export interface WebNovelRelayResult {
  ok: true;
  url: string;
  html: string;
}

interface RelayOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

async function readHtml(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new WebNovelProxyError("本文が大きすぎるため取得できません。", 413);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
    await response.body?.cancel();
    throw new WebNovelProxyError("取得先からHTMLを受け取れませんでした。", 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new WebNovelProxyError("本文を取得できませんでした。", 502);
  const decoder = new TextDecoder("utf-8");
  const text: string[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new WebNovelProxyError("本文が大きすぎるため取得できません。", 413);
      }
      text.push(decoder.decode(chunk.value, { stream: true }));
    }
    text.push(decoder.decode());
    return text.join("");
  } finally {
    reader.releaseLock();
  }
}

/** Public, anonymous HTML only. Cookies and user-supplied headers are never sent. */
export function createWebNovelRelay(options: RelayOptions = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;
  const maxBytes = options.maxBytes ?? MAX_WEB_NOVEL_BYTES;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const cache = new Map<string, { expires: number; result: WebNovelRelayResult }>();
  const pending = new Map<string, Promise<WebNovelRelayResult>>();

  async function request(url: string): Promise<WebNovelRelayResult> {
    let current = url;
    const signal = AbortSignal.timeout(timeoutMs);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetchImpl(current, {
        redirect: "manual",
        credentials: "omit",
        headers: { Accept: "text/html,application/xhtml+xml" },
        signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (redirects === 3) throw new WebNovelProxyError("転送が多すぎるため取得できません。", 502);
        const location = response.headers.get("location");
        if (!location) throw new WebNovelProxyError("取得先の転送URLが不正です。", 502);
        try {
          const target = location.trim();
          if (/[\u0000-\u0020\u007f\\]/.test(target)) throw new Error("Invalid redirect");
          current = normalizeWebNovelUrl(
            /^[a-z][a-z\d+.-]*:/i.test(target) ? target
              : target.startsWith("//") ? `https:${target}`
                : new URL(target, current).href,
          );
        } catch {
          throw new WebNovelProxyError("対応していないページへ転送されました。", 502);
        }
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new WebNovelProxyError(
          response.status === 404 ? "作品・エピソードが見つかりませんでした。" : "取得先が本文を返しませんでした。時間をおいてお試しください。",
          response.status === 404 ? 404 : 502,
        );
      }
      return { ok: true, url: current, html: await readHtml(response, maxBytes) };
    }
    throw new WebNovelProxyError("本文を取得できませんでした。", 502);
  }

  return async (input: string): Promise<WebNovelRelayResult> => {
    const url = normalizeWebNovelUrl(input);
    const cached = cache.get(url);
    if (cached && cached.expires > now()) return cached.result;
    cache.delete(url);
    const existing = pending.get(url);
    if (existing) return existing;
    const operation = request(url).then((result) => {
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(url, { result, expires: now() + cacheTtlMs });
      return result;
    }).catch((error: unknown) => {
      if (error instanceof WebNovelProxyError) throw error;
      throw new WebNovelProxyError(
        error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
          ? "取得に時間がかかっています。時間をおいてお試しください。"
          : "本文を取得できませんでした。時間をおいてお試しください。",
        502,
      );
    }).finally(() => pending.delete(url));
    pending.set(url, operation);
    return operation;
  };
}

export function createWebNovelMiddleware(relay = createWebNovelRelay()) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const requestUrl = new URL(req.url || "/", "http://localhost");
    if (requestUrl.pathname !== "/__web-novel") return next();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const send = (status: number, result: object) => {
      res.statusCode = status;
      res.end(JSON.stringify(result));
    };
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return send(405, { ok: false, error: "GETで取得してください。" });
    }
    try {
      if (requestUrl.searchParams.getAll("url").length !== 1) throw new WebNovelProxyError(INVALID_URL);
      const charset = requestUrl.searchParams.get("charset") || "UTF-8";
      if (!/^utf-8$/i.test(charset)) throw new WebNovelProxyError("文字コードはUTF-8を指定してください。");
      send(200, await relay(requestUrl.searchParams.get("url") || ""));
    } catch (error) {
      send(error instanceof WebNovelProxyError ? error.status : 502, {
        ok: false,
        error: error instanceof WebNovelProxyError ? error.message : "本文を取得できませんでした。",
      });
    }
  };
}

export function webNovelProxyPlugin(): Plugin {
  return {
    name: "web-novel-public-html-relay",
    configureServer(server) {
      server.middlewares.use(createWebNovelMiddleware());
    },
  };
}
