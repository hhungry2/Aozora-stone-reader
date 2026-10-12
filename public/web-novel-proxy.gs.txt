/**
 * HTML relay adapted from TxtMiruOnTheWeb/server/ActionScript.js.
 * Copyright (c) 2021 gearsns, MIT License.
 * https://github.com/gearsns/TxtMiruOnTheWeb
 * Upstream: da2c63591aa9ac0db1d0823e8f5bfb962eeaef63
 * Deploy your own copy. No cookies, login or access-control bypass is supported.
 *
 * MIT License
 *
 * Copyright (c) 2021 gearsns
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
var WEB_NOVEL_MAX_BYTES_ = 2 * 1024 * 1024;
var WEB_NOVEL_INVALID_URL_ = "なろう・カクヨムの作品またはエピソードのURLを指定してください。";

/** Keep this normalization in sync with server/web-novel-proxy.ts. */
function normalizeWebNovelUrl_(input) {
  var value = String(input || "").trim();
  if (/[\u0000-\u0020\u007f\\]/.test(value)) throw new Error(WEB_NOVEL_INVALID_URL_);
  var match = value.length <= 4096
    ? /^https:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?(?:#[\s\S]*)?$/i.exec(value)
    : null;
  if (!match) throw new Error(WEB_NOVEL_INVALID_URL_);
  var host = match[1].toLowerCase();
  var path = match[2] || "/";
  if (host === "ncode.syosetu.com") {
    var narou = /^\/(n[a-z0-9]+)(?:\/(\d+))?\/?$/i.exec(path);
    if (!narou) throw new Error(WEB_NOVEL_INVALID_URL_);
    var episode = narou[2] && narou[2].replace(/^0+/, "");
    if (narou[2] !== undefined && !episode) throw new Error(WEB_NOVEL_INVALID_URL_);
    var normalized = "https://" + host + "/" + narou[1].toLowerCase() + "/" + (episode ? episode + "/" : "");
    if (!episode && match[3]) {
      var page;
      match[3].split("&").forEach(function(pair) {
        var separator = pair.indexOf("=");
        var key;
        var entry;
        try {
          key = decodeURIComponent((separator < 0 ? pair : pair.slice(0, separator)).replace(/\+/g, " "));
          entry = decodeURIComponent((separator < 0 ? "" : pair.slice(separator + 1)).replace(/\+/g, " "));
        } catch (error) {
          throw new Error(WEB_NOVEL_INVALID_URL_);
        }
        if (key !== "p") return;
        if (page !== undefined || !/^\d+$/.test(entry)) throw new Error(WEB_NOVEL_INVALID_URL_);
        page = entry.replace(/^0+/, "");
        if (!page) throw new Error(WEB_NOVEL_INVALID_URL_);
      });
      if (page) normalized += "?p=" + page;
    }
    return normalized;
  }
  if (host === "kakuyomu.jp" && /^\/works\/\d+(?:\/episodes\/\d+)?\/?$/.test(path)) {
    return "https://" + host + path.replace(/\/$/, "");
  }
  throw new Error(WEB_NOVEL_INVALID_URL_);
}

// Apps Script does not provide the browser URL constructor.
function resolveWebNovelRedirect_(location, current) {
  var target = String(location || "").trim();
  if (!target || /[\u0000-\u0020\u007f\\]/.test(target)) throw new Error("取得先の転送URLが不正です。");
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return normalizeWebNovelUrl_(target);
  if (target.indexOf("//") === 0) return normalizeWebNovelUrl_("https:" + target);
  var base = /^(https:\/\/[^/]+)(\/[^?#]*)(?:\?[^#]*)?$/.exec(current);
  if (!base) throw new Error(WEB_NOVEL_INVALID_URL_);
  if (target[0] === "?") return normalizeWebNovelUrl_(base[1] + base[2] + target);
  if (target[0] === "#") return normalizeWebNovelUrl_(current + target);
  var relative = target[0] === "/" ? target : base[2].slice(0, base[2].lastIndexOf("/") + 1) + target;
  var suffixAt = relative.search(/[?#]/);
  var path = suffixAt < 0 ? relative : relative.slice(0, suffixAt);
  var suffix = suffixAt < 0 ? "" : relative.slice(suffixAt);
  var segments = [];
  path.split("/").forEach(function(segment) {
    if (segment === "..") segments.pop();
    else if (segment !== ".") segments.push(segment);
  });
  return normalizeWebNovelUrl_(base[1] + segments.join("/") + suffix);
}

function webNovelHeader_(headers, name) {
  var key = Object.keys(headers).filter(function(entry) { return entry.toLowerCase() === name; })[0];
  var value = key === undefined ? "" : headers[key];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function fetchWebNovelHtml_(url) {
  var current = url;
  for (var redirects = 0; redirects <= 3; redirects++) {
    var response;
    try {
      response = UrlFetchApp.fetch(current, {
        method: "get",
        followRedirects: false,
        muteHttpExceptions: true,
        validateHttpsCertificates: true,
        headers: { Accept: "text/html,application/xhtml+xml" }
      });
    } catch (error) {
      throw new Error("本文を取得できませんでした。時間をおいてお試しください。");
    }
    var status = response.getResponseCode();
    var headers = response.getAllHeaders();
    if ([301, 302, 303, 307, 308].indexOf(status) !== -1) {
      if (redirects === 3) throw new Error("転送が多すぎるため取得できません。");
      try {
        current = resolveWebNovelRedirect_(webNovelHeader_(headers, "location"), current);
      } catch (error) {
        throw new Error("対応していないページへ転送されました。");
      }
      continue;
    }
    if (status === 404) throw new Error("作品・エピソードが見つかりませんでした。");
    if (status < 200 || status >= 300) throw new Error("取得先が本文を返しませんでした。時間をおいてお試しください。");
    if (Number(webNovelHeader_(headers, "content-length")) > WEB_NOVEL_MAX_BYTES_) {
      throw new Error("本文が大きすぎるため取得できません。");
    }
    if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(webNovelHeader_(headers, "content-type"))) {
      throw new Error("取得先からHTMLを受け取れませんでした。");
    }
    if (response.getBlob().getBytes().length > WEB_NOVEL_MAX_BYTES_) {
      throw new Error("本文が大きすぎるため取得できません。");
    }
    return { ok: true, url: current, html: response.getContentText("UTF-8") };
  }
  throw new Error("本文を取得できませんでした。");
}

function createWebNovelJson_(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var parameters = e && e.parameter || {};
    if (e && e.parameters && e.parameters.url && e.parameters.url.length !== 1) {
      throw new Error(WEB_NOVEL_INVALID_URL_);
    }
    if (!/^utf-8$/i.test(parameters.charset || "UTF-8")) {
      throw new Error("文字コードはUTF-8を指定してください。");
    }
    var url = normalizeWebNovelUrl_(parameters.url);
    var key = "novel-" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, url));
    var cache;
    var cached;
    try {
      cache = CacheService.getScriptCache();
      cached = cache.get(key);
    } catch (error) { /* An unavailable cache must not block reading. */ }
    if (cached) return createWebNovelJson_(JSON.parse(cached));
    var result = fetchWebNovelHtml_(url);
    var json = JSON.stringify(result);
    // CacheService has a 100 KB limit per value; long episodes are simply uncached.
    if (cache && Utilities.newBlob(json).getBytes().length < 90 * 1024) {
      try { cache.put(key, json, 30); } catch (error) { /* Caching is best effort. */ }
    }
    return createWebNovelJson_(result);
  } catch (error) {
    return createWebNovelJson_({ ok: false, error: error && error.message || "本文を取得できませんでした。" });
  }
}
