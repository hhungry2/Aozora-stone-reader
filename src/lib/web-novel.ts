import type { Book, TextBlock } from "../types";

/**
 * Site adapters adapted from TxtMiru on the Web's Narou / Kakuyomu plugins:
 * https://github.com/gearsns/TxtMiruOnTheWeb/blob/da2c63591aa9ac0db1d0823e8f5bfb962eeaef63/js/TxtMiruSitePlugin.js
 * Copyright (c) 2021 gearsns, MIT License. See third_party/TxtMiruOnTheWeb/LICENSE.
 *
 * Its pager selectors and Apollo table-of-contents traversal are retained here.
 * The document-to-Book conversion is separate: source HTML is never rendered,
 * and native ruby markup is preserved as annotation ranges for both readers.
 */
export type WebNovelSite = "narou" | "kakuyomu";

export interface WebNovelLink {
  title: string;
  url: string;
  chapter?: string;
}

export interface WebNovelInfo {
  site: WebNovelSite;
  siteName: string;
  url: string;
  workUrl: string;
  title: string;
  author: string;
  description: string;
  episodeTitle: string;
  previousUrl?: string;
  nextUrl?: string;
  indexPagePreviousUrl?: string;
  indexPageNextUrl?: string;
  episodes: WebNovelLink[];
}

export interface WebNovelPage {
  info: WebNovelInfo;
  book: Book | null;
}

const VERSION = "txtmiru-stone-1";
const URL_MESSAGE =
  "小説家になろう、またはカクヨムの公開作品・エピソードのHTTPS URLを入力してください。";

/** Canonical URLs also form the boundary for chapter navigation and the relay. */
export function normalizeWebNovelUrl(input: string): string {
  const source = input.trim();
  if (!source || /[\u0000-\u0020\u007f\\]/u.test(source))
    throw new Error(URL_MESSAGE);
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error(URL_MESSAGE);
  }
  const authority = source.match(/^https:\/\/([^/?#]+)/iu)?.[1];
  if (
    url.protocol !== "https:" ||
    !authority ||
    authority.includes(":") ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error(URL_MESSAGE);

  let pathname: string;
  let query = "";
  if (url.hostname === "ncode.syosetu.com") {
    const match = url.pathname.match(/^\/(n[a-z0-9]+)(?:\/([0-9]+))?\/?$/iu);
    if (!match) throw new Error(URL_MESSAGE);
    const episode = match[2] ? positiveInteger(match[2]) : undefined;
    if (match[2] && !episode) throw new Error(URL_MESSAGE);
    pathname = `/${match[1].toLowerCase()}/${episode ? `${episode}/` : ""}`;
    if (!episode && url.searchParams.has("p")) {
      const pages = url.searchParams.getAll("p");
      const page = pages.length === 1 ? positiveInteger(pages[0]) : undefined;
      if (!page) throw new Error("目次のページ番号が不正です。");
      query = `?p=${page}`;
    }
  } else if (url.hostname === "kakuyomu.jp") {
    const match = url.pathname.match(
      /^\/works\/([0-9]+)(?:\/episodes\/([0-9]+))?\/?$/u,
    );
    if (!match) throw new Error(URL_MESSAGE);
    pathname = `/works/${match[1]}${match[2] ? `/episodes/${match[2]}` : ""}`;
  } else {
    throw new Error(URL_MESSAGE);
  }
  return `https://${url.hostname}${pathname}${query}`;
}

function positiveInteger(input: string): string | undefined {
  if (!/^[0-9]+$/u.test(input)) return undefined;
  return input.replace(/^0+/u, "") || undefined;
}

function address(input: string) {
  const url = normalizeWebNovelUrl(input);
  const parsed = new URL(url);
  const pieces = parsed.pathname.split("/").filter(Boolean);
  const site: WebNovelSite =
    parsed.hostname === "ncode.syosetu.com" ? "narou" : "kakuyomu";
  const workId = site === "narou" ? pieces[0] : pieces[1];
  const episodeId = site === "narou" ? pieces[1] : pieces[3];
  const workUrl =
    site === "narou"
      ? `https://ncode.syosetu.com/${workId}/`
      : `https://kakuyomu.jp/works/${workId}`;
  return { url, site, workId, episodeId, workUrl };
}

export function webNovelId(input: string): string {
  const source = address(input);
  const indexPage = new URL(source.url).searchParams.get("p");
  return `web-${source.site}-${source.workId}${source.episodeId ? `-${source.episodeId}` : ""}${indexPage ? `-index-${indexPage}` : ""}`;
}

const cleanText = (value: string | null | undefined) =>
  (value || "").replace(/[ \t\r\n\f]+/gu, " ").trim();
const elementText = (doc: ParentNode, selector: string) =>
  cleanText(doc.querySelector(selector)?.textContent);
const metadata = (doc: Document, name: string) =>
  cleanText(
    doc
      .querySelector(`meta[name="${name}"],meta[property="${name}"]`)
      ?.getAttribute("content"),
  );

function sameWorkLink(
  raw: string | null,
  info: WebNovelInfo,
): string | undefined {
  if (!raw) return undefined;
  try {
    const linked = address(new URL(raw, info.url).href);
    return linked.workUrl === info.workUrl ? linked.url : undefined;
  } catch {
    return undefined;
  }
}

function episodeLink(
  raw: string | null,
  info: WebNovelInfo,
): string | undefined {
  const url = sameWorkLink(raw, info);
  return url && address(url).episodeId ? url : undefined;
}

function indexLink(raw: string | null, info: WebNovelInfo): string | undefined {
  const url = sameWorkLink(raw, info);
  return url && !address(url).episodeId ? url : undefined;
}

function navigation(
  doc: Document,
  info: WebNovelInfo,
  previous: string,
  next: string,
  isIndex: boolean,
) {
  const resolve = isIndex ? indexLink : episodeLink;
  const find = (selector: string, text: RegExp) => {
    for (const element of doc.querySelectorAll<
      HTMLAnchorElement | HTMLLinkElement
    >(selector)) {
      const candidate = resolve(element.getAttribute("href"), info);
      if (candidate && candidate !== info.url) return candidate;
    }
    for (const element of doc.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (!text.test(cleanText(element.textContent))) continue;
      const candidate = resolve(element.getAttribute("href"), info);
      if (candidate && candidate !== info.url) return candidate;
    }
    return undefined;
  };
  const before = find(
    previous,
    /^(?:[«≪<←]\s*)?(?:前へ|前のエピソード|前の話|前話|前のページ)(?:\s|$)/u,
  );
  const after = find(
    next,
    /^(?:次へ|次のエピソード|次の話|次話|次のページ)(?:\s|$)/u,
  );
  if (isIndex) {
    info.indexPagePreviousUrl = before;
    info.indexPageNextUrl = after;
  } else {
    info.previousUrl = before;
    info.nextUrl = after;
  }
}

function initialInfo(input: string): WebNovelInfo {
  const source = address(input);
  return {
    site: source.site,
    siteName: source.site === "narou" ? "小説家になろう" : "カクヨム",
    url: source.url,
    workUrl: source.workUrl,
    title: "",
    author: "",
    description: "",
    episodeTitle: "",
    episodes: [],
  };
}

function addEpisode(
  info: WebNovelInfo,
  raw: string | null,
  title: string,
  chapter = "",
) {
  const url = episodeLink(raw, info);
  if (!url || !title || info.episodes.some((episode) => episode.url === url))
    return;
  info.episodes.push({ title, url, ...(chapter ? { chapter } : {}) });
}

function narouDocument(doc: Document, info: WebNovelInfo): Element[] {
  const source = address(info.url);
  const body = storyRegion(
    doc,
    "#novel_honbun,.js-novel-text:not(.p-novel__text--preface):not(.p-novel__text--afterword),.p-novel__text:not(.p-novel__text--preface):not(.p-novel__text--afterword)",
  );
  const regions = body
    ? distinctRegions(
        doc.querySelectorAll(
          "#novel_p,#novel_honbun,#novel_a,.js-novel-text,.p-novel__text",
        ),
      )
    : [];
  if (source.episodeId) {
    info.episodeTitle = elementText(
      doc,
      ".p-novel__subtitle-episode,.novel_subtitle,.p-novel__title--rensai,.p-novel__title",
    );
    info.title = elementText(doc, ".novel_title");
    if (!info.title) {
      for (const link of doc.querySelectorAll<HTMLAnchorElement>(
        ".c-announce a[href]",
      )) {
        if (sameWorkLink(link.getAttribute("href"), info) === info.workUrl) {
          info.title = cleanText(link.textContent);
          break;
        }
      }
    }
    const fullTitle = metadata(doc, "og:title") || cleanText(doc.title);
    info.title ||=
      info.episodeTitle && fullTitle.endsWith(` - ${info.episodeTitle}`)
        ? fullTitle.slice(0, -info.episodeTitle.length - 3)
        : fullTitle;
  } else {
    info.title =
      elementText(doc, ".p-novel__title,.novel_title") ||
      metadata(doc, "og:title") ||
      cleanText(doc.title);
  }
  info.author = (
    elementText(
      doc,
      ".p-novel__author a,.novel_writername a,.novel_writername",
    ) ||
    metadata(doc, "twitter:creator") ||
    metadata(doc, "author") ||
    elementText(doc, '.c-announce a[href^="https://mypage.syosetu.com/"]') ||
    elementText(doc, ".p-novel__author")
  ).replace(/^作者\s*[:：]\s*/u, "");
  info.description =
    elementText(doc, "#novel_ex,.p-novel__summary") ||
    metadata(doc, "description") ||
    metadata(doc, "og:description");

  // TxtMiru's Narou pager supports both the old text labels and current BEM classes.
  navigation(
    doc,
    info,
    'link[rel="prev"],a.c-pager__item--before',
    'link[rel="next"],a.c-pager__item--next',
    !body,
  );
  if (!body) {
    let chapter = "";
    for (const element of doc.querySelectorAll(
      ".p-eplist__chapter-title,.chapter_title,.p-eplist__subtitle,.novel_sublist2 .subtitle a,.novel_sublist .subtitle a",
    )) {
      if (element.matches(".p-eplist__chapter-title,.chapter_title"))
        chapter = cleanText(element.textContent);
      else
        addEpisode(
          info,
          element.getAttribute("href"),
          cleanText(element.textContent),
          chapter,
        );
    }
    if (!info.episodes.length) {
      for (const element of doc.querySelectorAll<HTMLAnchorElement>("a[href]"))
        addEpisode(
          info,
          element.getAttribute("href"),
          cleanText(element.textContent),
        );
    }
  }
  return regions;
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";

function kakuyomuToc(doc: Document, info: WebNovelInfo) {
  const script = doc.getElementById("__NEXT_DATA__");
  if (!script?.textContent) return;
  try {
    const json = object(JSON.parse(script.textContent));
    const props = object(json?.props);
    const pageProps = object(props?.pageProps);
    const state = object(pageProps?.__APOLLO_STATE__);
    if (!state) return;
    const resolve = (value: unknown) => {
      const entry = object(value);
      return typeof entry?.__ref === "string"
        ? object(state[entry.__ref])
        : entry;
    };
    const source = address(info.url);
    const rootQuery = object(state.ROOT_QUERY);
    const work =
      object(state[`Work:${source.workId}`]) ||
      resolve(rootQuery?.[`work({"id":"${source.workId}"})`]);
    if (!work) return;
    info.title = cleanText(string(work.title)) || info.title;
    const author = resolve(work.author);
    info.author =
      cleanText(
        string(work.alternateAuthorName) ||
          string(author?.activityName) ||
          string(author?.name),
      ) || info.author;
    info.description =
      [string(work.catchphrase), string(work.introduction)]
        .filter(Boolean)
        .join("\n")
        .trim() || info.description;
    // TxtMiru GetToc's Apollo refs; the current work pages renamed this array to V2.
    const table = work.tableOfContentsV2 ?? work.tableOfContents;
    if (!Array.isArray(table)) return;
    for (const entry of table) {
      const section = resolve(entry);
      if (!section) continue;
      const chapter = cleanText(string(resolve(section.chapter)?.title));
      if (!Array.isArray(section.episodeUnions)) continue;
      for (const reference of section.episodeUnions) {
        const episode = resolve(reference);
        if (
          !episode ||
          (episode.__typename && episode.__typename !== "Episode")
        )
          continue;
        const id = string(episode.id);
        if (!/^[0-9]+$/u.test(id)) continue;
        addEpisode(
          info,
          `${info.workUrl}/episodes/${id}`,
          cleanText(string(episode.title)),
          chapter,
        );
      }
    }
  } catch {
    // A missing/changed application-data object can fall back to public HTML links.
  }
}

function kakuyomuDocument(doc: Document, info: WebNovelInfo): Element[] {
  const body = storyRegion(doc, ".widget-episodeBody,.js-episode-body");
  info.episodeTitle = body
    ? elementText(doc, ".widget-episodeTitle,#episodeTitle")
    : "";
  info.title = elementText(doc, "#contentMain-header-workTitle,#workTitle");
  if (!info.title) {
    for (const link of doc.querySelectorAll<HTMLAnchorElement>(
      'a[itemprop="item"][href],h1 a[href]',
    )) {
      if (sameWorkLink(link.getAttribute("href"), info) === info.workUrl) {
        info.title =
          cleanText(link.getAttribute("title")) || cleanText(link.textContent);
        break;
      }
    }
  }
  info.author =
    elementText(doc, "#contentMain-header-author,#workAuthor-activityName") ||
    metadata(doc, "author");
  info.description =
    elementText(doc, "#introduction,.widget-work-introduction") ||
    metadata(doc, "description") ||
    metadata(doc, "og:description");
  kakuyomuToc(doc, info);
  if (!info.title) {
    let title = metadata(doc, "og:title") || cleanText(doc.title);
    title = title.replace(/\s*[-｜|]\s*カクヨム$/u, "");
    if (info.episodeTitle && title.startsWith(`${info.episodeTitle} - `))
      title = title.slice(info.episodeTitle.length + 3);
    const author = title.match(/（([^（）]+)）$/u);
    if (author) {
      info.author ||= author[1];
      title = title.slice(0, -author[0].length);
    }
    info.title = title;
  }
  if (!body && !info.episodes.length) {
    let chapter = "";
    for (const element of doc.querySelectorAll(
      ".widget-toc-chapter-title,.widget-toc-chapter-titleLabel,a[href]",
    )) {
      if (
        element.matches(
          ".widget-toc-chapter-title,.widget-toc-chapter-titleLabel",
        )
      )
        chapter = cleanText(element.textContent);
      else {
        const title =
          elementText(element, ".widget-toc-episode-titleLabel") ||
          cleanText(element.textContent);
        if (
          /^(?:1話目から読む|最初から読む|続きから読む|続きを読む)$/u.test(
            title,
          )
        )
          continue;
        addEpisode(info, element.getAttribute("href"), title, chapter);
      }
    }
  }
  navigation(
    doc,
    info,
    'link[rel="prev"],a[data-link-click-action-name="WorksEpisodesEpisodeHeaderPreviousEpisode"],a.js-read-previous-episode',
    'link[rel="next"],a[data-link-click-action-name="WorksEpisodesEpisodeFooterNextEpisode"],a.js-read-next-episode',
    !body,
  );
  return body ? [body] : [];
}

function distinctRegions(elements: NodeListOf<Element>): Element[] {
  const candidates = [...elements].filter(
    (element) => !ignoredElement(element),
  );
  return candidates.filter(
    (element) =>
      !candidates.some((other) => other !== element && other.contains(element)),
  );
}

function storyRegion(doc: Document, selector: string): Element | undefined {
  return [...doc.querySelectorAll(selector)].find(
    (element) => !ignoredElement(element),
  );
}

/** Stable content fingerprint, deliberately not represented as a SHA-256 digest. */
function fingerprint(input: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const unit = input.charCodeAt(index);
    first = Math.imul(first ^ unit, 0x01000193);
    second = Math.imul(second ^ unit, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function safeImage(raw: string | null, base: string): string | undefined {
  if (!raw || /[\u0000-\u0020\u007f]/u.test(raw)) return;
  try {
    const url = new URL(raw, base);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes(".") ||
      /^\[|^[0-9.]+$/u.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal)$/iu.test(url.hostname)
    )
      return;
    url.hash = "";
    return url.href;
  } catch {
    return;
  }
}

const discardedTags = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "FORM",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "NAV",
  "HEADER",
  "FOOTER",
  "ASIDE",
  "SVG",
  "AUDIO",
  "VIDEO",
  "CANVAS",
  "LINK",
  "META",
]);
const structuralTags = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "BLOCKQUOTE",
  "LI",
  "PRE",
]);

function ignoredElement(element: Element): boolean {
  return (
    discardedTags.has(element.tagName) ||
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true" ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/iu.test(
      element.getAttribute("style") || "",
    ) ||
    /(?:^|[\s_-])(?:ad|ads|advertisement|advert|banner)(?:[\s_-]|$)/iu.test(
      `${element.id} ${element.className}`,
    )
  );
}

/** Convert only the selected story region; all offsets use JavaScript UTF-16. */
function textBlocks(regions: Element[], baseUrl: string) {
  const blocks: TextBlock[] = [];
  const warnings = new Set<string>();
  const usedIds = new Map<string, number>();
  let current: Omit<TextBlock, "id"> = blank();
  let sourceId = "";
  let sourceLine = 0;
  let blockKind: TextBlock["kind"] = "paragraph";
  let level: number | undefined;
  let indent = 0;

  function blank(): Omit<TextBlock, "id"> {
    return {
      kind: "paragraph",
      text: "",
      rubies: [],
      emphasis: [],
      inlineImages: [],
      indent: 0,
    };
  }
  function flush(force = false) {
    current.text = current.text.replace(/[ \t\r\n\f]+$/u, "");
    if (current.text || force) {
      current.kind = blockKind;
      current.indent = indent;
      if (level) current.level = level;
      for (const entries of [
        current.rubies,
        current.emphasis,
        current.inlineImages,
      ])
        for (const entry of entries)
          entry.end = Math.min(entry.end, current.text.length);
      const key = sourceId
        ? `${sourceId}:${sourceLine++}`
        : `${blockKind}:${current.text}`;
      const stem = `web-b-${fingerprint(key)}`;
      const occurrence = (usedIds.get(stem) || 0) + 1;
      usedIds.set(stem, occurrence);
      blocks.push({
        id: occurrence === 1 ? stem : `${stem}-${occurrence}`,
        ...current,
      });
    }
    current = blank();
  }
  function append(value: string) {
    value = value.replace(/[ \t\r\n\f]+/gu, " ");
    if (!current.text || current.text.endsWith(" "))
      value = value.replace(/^ +/u, "");
    current.text += value;
  }
  function addRuby(start: number, reading: string) {
    reading = cleanText(reading);
    if (!reading || current.text.length <= start) return;
    if (/^[・﹅●◦]+$/u.test(reading))
      current.emphasis.push({
        start,
        end: current.text.length,
        kind: "sesame_dot",
      });
    else current.rubies.push({ start, end: current.text.length, reading });
  }
  function readingText(element: Element): string {
    let text = "";
    function collect(node: Node) {
      if (node.nodeType === 3) text += node.textContent || "";
      else if (node.nodeType === 1) {
        const child = node as Element;
        if (ignoredElement(child) || child.tagName === "RP") return;
        if (child.tagName === "BR") text += " ";
        else for (const nested of child.childNodes) collect(nested);
      }
    }
    for (const node of element.childNodes) collect(node);
    return text;
  }
  function ruby(element: Element) {
    const bases = [...element.children].filter(
      (child) => child.tagName === "RB",
    );
    const readings = [...element.children].filter(
      (child) => child.tagName === "RT",
    );
    const baseNodes = [...element.childNodes].filter(
      (child) =>
        child.nodeType !== 1 ||
        !["RT", "RP", "RTC"].includes((child as Element).tagName),
    );
    if (bases.length === readings.length && readings.length > 1) {
      bases.forEach((child, index) => {
        const start = current.text.length;
        for (const node of child.childNodes) visit(node, true);
        addRuby(start, readingText(readings[index]));
      });
    } else if (readings.length <= 1) {
      const start = current.text.length;
      const rubyCount = current.rubies.length;
      for (const child of baseNodes) visit(child, true);
      if (current.rubies.length === rubyCount)
        addRuby(start, readings[0] ? readingText(readings[0]) : "");
      else warnings.add("入れ子ルビは内側の読みを表示しています。");
    } else {
      let start = current.text.length;
      for (const child of element.childNodes) {
        if (child.nodeType === 1 && (child as Element).tagName === "RT") {
          addRuby(start, readingText(child as Element));
          start = current.text.length;
        } else if (
          child.nodeType !== 1 ||
          !["RP", "RTC"].includes((child as Element).tagName)
        )
          visit(child, true);
      }
    }
  }
  function visit(node: Node, inline = false) {
    if (node.nodeType === 3) {
      append(node.textContent || "");
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (
      ignoredElement(element) ||
      ["RT", "RP", "RTC"].includes(element.tagName)
    )
      return;
    if (element.tagName === "BR") {
      if (inline) append(" ");
      else flush(true);
      return;
    }
    if (element.tagName === "IMG") {
      const src = safeImage(element.getAttribute("src"), baseUrl);
      if (!src) {
        warnings.add("安全なHTTPS URLでない画像を省略しました。");
        return;
      }
      const start = current.text.length;
      current.text += "\ufffc";
      current.inlineImages.push({
        start,
        end: start + 1,
        src,
        sourceUrl: src,
        alt: cleanText(element.getAttribute("alt")) || "作品の画像",
      });
      return;
    }
    if (element.tagName === "RUBY") {
      ruby(element);
      return;
    }
    const heading = /^H[1-6]$/u.test(element.tagName);
    const structural =
      !inline && (heading || structuralTags.has(element.tagName));
    const previous = { sourceId, sourceLine, blockKind, level, indent };
    if (structural) {
      flush();
      sourceId = element.id || "";
      sourceLine = 0;
      if (heading) {
        blockKind = "heading";
        level = Number(element.tagName.slice(1));
      }
      if (element.tagName === "BLOCKQUOTE") indent += 1;
    }
    const beforeBlocks = blocks.length;
    const start = current.text.length;
    for (const child of element.childNodes) visit(child, inline);
    if (
      /(?:^|\s)(?:emphasisDots|sesame_dot|bouten)(?:\s|$)/u.test(
        element.getAttribute("class") || "",
      ) &&
      current.text.length > start
    )
      current.emphasis.push({
        start,
        end: current.text.length,
        kind: "sesame_dot",
      });
    if (structural) {
      flush(element.tagName === "P" && beforeBlocks === blocks.length);
      ({ sourceId, sourceLine, blockKind, level, indent } = previous);
    }
  }
  for (const region of regions) {
    flush();
    sourceId = region.id;
    sourceLine = 0;
    blockKind =
      /^(?:novel_p|novel_a)$/u.test(region.id) ||
      region.matches(".p-novel__text--preface,.p-novel__text--afterword")
        ? "note"
        : "paragraph";
    for (const child of region.childNodes) visit(child);
    flush();
  }
  return { blocks, warnings: [...warnings] };
}

function makeBook(info: WebNovelInfo, regions: Element[]): Book {
  const { blocks, warnings } = textBlocks(regions, info.url);
  if (!blocks.some((block) => block.text.trim()))
    throw new Error(
      "公開されている本文を見つけられませんでした。元のサイトで公開状態を確認してください。",
    );
  const text = blocks.map((block) => block.text).join("\n");
  const toc = blocks
    .filter((block) => block.kind === "heading" && block.text)
    .map((block) => ({
      title: block.text,
      blockId: block.id,
      level: block.level || 1,
    }));
  const features = [
    blocks.some((block) => block.rubies.length) && "ルビ",
    blocks.some((block) => block.emphasis.length) && "傍点",
    blocks.some((block) => block.inlineImages.length) && "挿絵・図版",
    toc.length > 0 && "目次",
  ].filter((feature): feature is string => Boolean(feature));
  return {
    schemaVersion: 1,
    id: webNovelId(info.url),
    title: info.title || info.episodeTitle || "Web小説",
    titleKana: "",
    subtitle: info.episodeTitle,
    authors: info.author
      ? [
          {
            id: `web-author-${fingerprint(info.author)}`,
            name: info.author,
            kana: "",
            role: "著者",
          },
        ]
      : [],
    authorLabel: info.author || "作者不明",
    cardUrl: info.url,
    dataPath: "",
    contentVersion: `${VERSION}-${fingerprint(JSON.stringify(blocks))}`,
    characterCount: [...text].length,
    excerpt: cleanText(text).slice(0, 120),
    features,
    availability: "available",
    blocks,
    toc,
    credits: `公開元：${info.siteName}\n${info.url}\n著作権は原作者${info.author ? `（${info.author}）` : ""}に帰属します。青空文庫の著作権切れ収録作品とは別の、公開ページの閲覧です。`,
    source: {
      url: info.url,
      fetchedAt: new Date().toISOString(),
      sha256: "",
      encoding: "UTF-8",
    },
    conversion: { version: VERSION, warnings },
  };
}

export function parseWebNovel(html: string, input: string): WebNovelPage {
  const info = initialInfo(input);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const regions =
    info.site === "narou"
      ? narouDocument(doc, info)
      : kakuyomuDocument(doc, info);
  if (!regions.length && !info.episodes.length)
    throw new Error(
      "本文や目次を見つけられませんでした。公開作品・エピソードのURLか、元のサイトで確認してください。",
    );
  return { info, book: regions.length ? makeBook(info, regions) : null };
}
