import {
  applyFontStyleSpans, FixedMeasurer, glyphElements, glyphParagraphs, Layouter, measureRuns,
  parseText, splitGraphemes, StoneContext,
  type FontMeasurer, type GlyphElement, type Run, type Token,
} from '@non-standardworld/stone-engine.js';
import { fontFamilies, latinFontFamilies, type Anchor, type Book, type ReaderSettings, type TextBlock } from '../types';
import { displayTitle } from '../lib/titles';

function readerFonts(settings: ReaderSettings) {
  return {
    japanese: { family: fontFamilies[settings.font] },
    latin: { family: latinFontFamilies[settings.latinFont] || fontFamilies[settings.font], scale: settings.latinScale },
  };
}

export interface BookRange {
  block: TextBlock;
  start: number;
  end: number;
}

export interface BookIndex {
  text: string;
  ranges: BookRange[];
}

export interface RubyPlacement {
  key: string;
  /** Original parent and reading offsets, independent of line wrapping. */
  sourceStart: number;
  readingOffset: number;
  reading: string;
  glyphs: GlyphElement[];
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

export interface InlineImagePlacement {
  src: string;
  alt: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReaderOpening {
  title: string;
  subtitle: string;
  author: string;
  glyphs: GlyphElement[];
  x: number;
  y: number;
  scale: number;
}

export interface ReaderPageData {
  start: Anchor;
  end: Anchor;
  globalStart: number;
  globalEnd: number;
  text: string;
  width: number;
  height: number;
  insetX: number;
  insetY: number;
  context: StoneContext;
  glyphs: GlyphElement[];
  rubies: RubyPlacement[];
  emphasis: { x: number; y: number; radius: number }[];
  images: InlineImagePlacement[];
  ranges: BookRange[];
  opening?: ReaderOpening;
}

/** Keep the title outside the source index so existing anchors and copying stay intact. */
function layoutOpening(book: Book, settings: ReaderSettings, width: number, height: number, measurer: FontMeasurer) {
  const vertical = settings.direction === 'tbRl';
  const title = displayTitle(book.title);
  const text = [title, book.subtitle, book.authorLabel].filter(Boolean).join('\n');
  if (!text) return null;
  const context = new StoneContext({
    direction: settings.direction, fontSize: settings.fontSize * 1.25, lineHeightScale: 1.6,
    punctuationMode: settings.punctuationMode, kinsoku: settings.kinsoku,
    dividesByWords: settings.dividesByWords, allowsTateChuYoko: settings.allowsTateChuYoko,
    fonts: readerFonts(settings),
  }, measurer);
  context.renderSize = vertical ? { width: Infinity, height } : { width, height: Infinity };
  const parsed = parseText(text, settings.dividesByWords);
  context.runs = parsed.runs;
  context.tokens = parsed.tokens;
  applyFontStyleSpans(context, [{ start: 0, end: title.length, fontWeight: 700 }]);
  measureRuns(context);
  new Layouter(context).layout();
  const left = Math.min(...context.runs.map((run) => run.frame.x));
  const top = Math.min(...context.runs.map((run) => run.frame.y));
  const right = Math.max(...context.runs.map((run) => run.frame.x + run.frame.width));
  const bottom = Math.max(...context.runs.map((run) => run.frame.y + run.frame.height));
  for (const run of context.runs) translateRun(run, -left, -top);
  const extent = vertical ? right - left : bottom - top;
  // Long titles and large font settings must still leave room for the body.
  const available = vertical ? width : height;
  const scale = Math.min(1, available * 0.4 / extent);
  const gap = Math.min(settings.fontSize * 1.5, available * 0.1);
  return {
    extent: extent * scale, gap,
    opening: {
      title, subtitle: book.subtitle, author: book.authorLabel,
      glyphs: glyphElements(context), x: 0, y: 0, scale,
    },
  };
}

/** Source positions stay independent of the selected page cache policy. */
export function indexBook(book: Book): BookIndex {
  const ranges: BookRange[] = [];
  const pieces: string[] = [];
  let offset = 0;
  book.blocks.forEach((block, i) => {
    const text = block.kind === 'image' && !block.text ? '\ufffc' : block.text;
    ranges.push({ block, start: offset, end: offset + text.length });
    pieces.push(text);
    offset += text.length;
    if (i + 1 < book.blocks.length) { pieces.push('\n'); offset += 1; }
  });
  return { text: pieces.join(''), ranges };
}

export function anchorAt(index: BookIndex, position: number): Anchor {
  const p = Math.max(0, Math.min(index.text.length, position));
  // A separator belongs to the preceding block: offset text.length is a valid anchor.
  // This is also used while continuously scrolling. Locate the first matching
  // end without walking every preceding paragraph of a long work.
  let low = 0;
  let high = index.ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (index.ranges[middle].end < p) low = middle + 1;
    else high = middle;
  }
  const range = index.ranges[low] ?? index.ranges.at(-1);
  return {
    blockId: range?.block.id ?? '',
    offset: range ? Math.min(p - range.start, range.end - range.start) : 0,
    context: range ? index.text.slice(p, Math.min(p + 32, range.end)) : '',
  };
}

export function positionOf(index: BookIndex, anchor: Anchor | null): number {
  if (!anchor) return 0;
  const range = index.ranges.find((r) => r.block.id === anchor.blockId);
  if (!range) return 0;
  return range.start + Math.max(0, Math.min(range.end - range.start, anchor.offset));
}

function runOffsets(runs: Run[]): number[] {
  let offset = 0;
  return runs.map((run) => { const start = offset; offset += run.char.length; return start; });
}

interface RubySpan { start: number; end: number; reading: string }

function rubySpans(index: BookIndex, start: number, end: number): RubySpan[] {
  return index.ranges.filter((r) => r.end > start && r.start < end).flatMap((r) =>
    r.block.rubies.map((ruby) => ({
      start: r.start + ruby.start - start,
      end: r.start + ruby.end - start,
      reading: ruby.reading,
    })).filter((ruby) => ruby.end > 0 && ruby.start < end - start),
  );
}

/** Avoid cuts inside a grapheme or ruby parent, including saved anchors from older data. */
function safeStart(index: BookIndex, requested: number): number {
  let start = Math.max(0, Math.min(index.text.length, requested));
  const range = index.ranges.find((r) => r.start <= start && start < r.end);
  if (range) {
    const local = start - range.start;
    const ruby = range.block.rubies.find((r) => r.start < local && local < r.end);
    if (ruby) start = range.start + ruby.start;
  }
  // Inspect a small prefix so a surrogate, variation selector or combining sequence remains intact.
  let prefix = Math.max(0, start - 64);
  if (prefix > 0 && /[\uDC00-\uDFFF]/u.test(index.text[prefix])) prefix -= 1;
  let boundary = prefix;
  for (const char of splitGraphemes(index.text.slice(prefix, Math.min(index.text.length, start + 64)))) {
    if (boundary + char.length > start) return boundary;
    boundary += char.length;
    if (boundary === start) return start;
  }
  return start;
}

function safeWindowEnd(index: BookIndex, start: number, limit: number): number {
  let end = safeStart(index, Math.min(index.text.length, start + limit));
  // If the entire available window is one unusually long ruby, report it instead of silently dropping text.
  if (end <= start && start < index.text.length) {
    const range = index.ranges.find((r) => r.start <= start && start < r.end);
    const ruby = range?.block.rubies.find((r) => range.start + r.start <= start && start < range.start + r.end);
    end = ruby && range ? range.start + ruby.end : start + (splitGraphemes(index.text.slice(start, start + 64))[0]?.length ?? 1);
  }
  return end;
}

function configureTokens(context: StoneContext, rubies: RubySpan[], offsets: number[], inlineSize: number): void {
  const original = context.tokens;
  const tokens: Token[] = [];
  let i = 0;
  while (i < context.runs.length) {
    const ruby = rubies.find((r) => r.start === offsets[i]);
    let end = i + 1;
    if (ruby) {
      while (end < context.runs.length && offsets[end] < ruby.end) end += 1;
    } else {
      const old = original[context.runs[i].tokenId];
      const intersectsRuby = rubies.some((r) => r.start < (offsets[old.end] ?? context.text.length) && r.end > offsets[i]);
      const advance = context.runs.slice(i, old.end).reduce((sum, run) => sum + run.advance, 0);
      if (!intersectsRuby && advance <= inlineSize) end = old.end;
    }
    // A parent longer than a line may continue on another line, but never on another page.
    const advance = context.runs.slice(i, end).reduce((sum, run) => sum + run.advance, 0);
    if (advance > inlineSize && end > i + 1) end = i + 1;
    const tokenId = tokens.length;
    tokens.push({ start: i, end });
    for (let j = i; j < end; j++) { context.runs[j].tokenId = tokenId; context.runs[j].tokenRunIndex = j - i; }
    i = end;
  }
  context.tokens = tokens;
}

function translateRun(run: Run, dx: number, dy: number): void {
  run.position = { x: run.position.x + dx, y: run.position.y + dy };
  run.frame = { ...run.frame, x: run.frame.x + dx, y: run.frame.y + dy };
}

/**
 * Stone lays out each source block with its own available inline width. This implements
 * block indentation on every continuation line without adding characters to the source.
 */
function layoutBlocks(context: StoneContext, index: BookIndex, start: number, end: number, offsets: number[], rubies: RubySpan[], bodyWidth: number, bodyHeight: number): void {
  const runs = context.runs;
  const sourceTokens = context.tokens;
  const combinedTokens: Token[] = [];
  const vertical = context.direction === 'tbRl';
  let lineBase = 0;
  for (const range of index.ranges) {
    const segmentStart = Math.max(start, range.start);
    const segmentEnd = Math.min(end, index.text.length, range.end + 1);
    if (segmentEnd <= segmentStart) continue;
    const localStart = segmentStart - start;
    const lo = offsets.findIndex((offset) => offset >= localStart);
    let hi = offsets.findIndex((offset) => offset >= segmentEnd - start);
    if (hi < 0) hi = runs.length;
    if (lo < 0 || hi <= lo) continue;
    const tokenStart = runs[lo].tokenId;
    const tokenEnd = runs[hi - 1].tokenId + 1;
    context.runs = runs.slice(lo, hi);
    context.tokens = sourceTokens.slice(tokenStart, tokenEnd).map((token) => ({ start: Math.max(0, token.start - lo), end: Math.min(hi - lo, token.end - lo) }));
    context.runs.forEach((run) => { run.tokenId -= tokenStart; });
    const existingIndent = range.block.text.match(/^　*/u)?.[0].length ?? 0;
    const requestedIndent = Math.max(0, range.block.indent - existingIndent) * context.fontSize;
    // Preserve a minimum of two body glyphs on narrow screens and high font sizes.
    const indent = Math.min(requestedIndent, Math.max(0, (vertical ? bodyHeight : bodyWidth) - context.fontSize * 2));
    const inline = (vertical ? bodyHeight : bodyWidth) - indent;
    context.renderSize = vertical ? { width: Infinity, height: inline } : { width: inline, height: Infinity };
    configureTokens(context, rubies.map((ruby) => ({ ...ruby, start: ruby.start - localStart, end: ruby.end - localStart })),
      offsets.slice(lo, hi).map((offset) => offset - localStart), inline);
    new Layouter(context).layout();
    const right = vertical ? Math.max(...context.runs.filter((run) => run.line === 0).map((run) => run.frame.x + run.frame.width)) : 0;
    const lineCount = Math.max(...context.runs.map((run) => run.line)) + 1;
    context.runs.forEach((run) => {
      translateRun(run, vertical ? bodyWidth - lineBase * context.lineHeight - right : indent,
        vertical ? indent : lineBase * context.lineHeight);
      run.line += lineBase;
      run.tokenId += combinedTokens.length;
    });
    combinedTokens.push(...context.tokens.map((token) => ({ start: token.start + lo, end: token.end + lo })));
    lineBase += lineCount;
  }
  context.runs = runs;
  context.tokens = combinedTokens;
  context.lineCount = lineBase;
  context.renderSize = vertical ? { width: Infinity, height: bodyHeight } : { width: bodyWidth, height: Infinity };
}

export class PaginationEngine {
  readonly index: BookIndex;
  private readonly cache = new Map<number, ReaderPageData>();
  private readonly predecessors = new Map<number, number>();
  private preparedPosition = 0;
  private preparedCount = 0;
  readonly windowSize: number;

  constructor(
    readonly book: Book,
    readonly settings: ReaderSettings,
    readonly width: number,
    readonly height: number,
    readonly measurer: FontMeasurer = new FixedMeasurer(),
    index?: BookIndex,
  ) {
    this.index = index ?? indexBook(book);
    const line = settings.fontSize * settings.lineHeight;
    this.windowSize = Math.max(512, Math.min(12000, Math.ceil(width * height / (settings.fontSize * line) * 3) + 256));
  }

  get cacheSize(): number { return this.cache.size; }
  get preparedBookPosition(): number { return this.preparedPosition; }
  get preparedBookPages(): number { return this.preparedCount; }

  /** Prepare glyphs without replacing the reader's forward/backward navigation path. */
  preloadPage(position: number): ReaderPageData {
    return this.layoutPage(position, undefined, false);
  }

  /** The cursor survives interruptions so paging does not restart full-book preparation. */
  preloadNextBookPage(): void {
    if (this.preparedPosition >= this.index.text.length) return;
    const page = this.preloadPage(this.preparedPosition);
    this.preparedPosition = page.globalEnd;
    this.preparedCount += 1;
  }

  pageAt(anchor: Anchor | null): ReaderPageData {
    return this.pageAtPosition(positionOf(this.index, anchor));
  }

  pagesAt(anchor: Anchor | null, count: 1 | 2 = 1): ReaderPageData[] {
    const first = this.pageAt(anchor);
    return count === 2 && first.globalEnd < this.index.text.length
      ? [first, this.pageAt(first.end)]
      : [first];
  }

  pageAtPosition(requested: number, stopAt?: number): ReaderPageData {
    return this.layoutPage(requested, stopAt, true);
  }

  /** Lay out a bounded source chunk along the unlimited progression axis. */
  layoutContinuousRange(start: number, end: number): ReaderPageData {
    return this.layoutPage(start, end, false, true);
  }

  private layoutPage(requested: number, stopAt: number | undefined, rememberPredecessor: boolean, continuous = false): ReaderPageData {
    const start = safeStart(this.index, requested);
    const cached = this.cache.get(start);
    if (!continuous && cached && (stopAt === undefined || cached.globalEnd <= stopAt)) {
      this.cache.delete(start); this.cache.set(start, cached);
      if (rememberPredecessor && cached.globalEnd > start) this.predecessors.set(cached.globalEnd, start);
      return cached;
    }
    const vertical = this.settings.direction === 'tbRl';
    const fontSize = this.settings.fontSize;
    const margin = 8;
    // SVG punctuation can extend before its inline frame at the start of a line.
    const leadingMargin = Math.max(margin, fontSize * 0.7);
    // Reserve a lane even with ruby hidden, so the toggle does not change pagination.
    const annotationLane = fontSize * 0.92;
    let bodyWidth = Math.max(fontSize * 2, this.width - margin - (vertical ? margin + annotationLane : leadingMargin));
    let bodyHeight = Math.max(fontSize * 2, this.height - margin - (vertical ? leadingMargin : margin + annotationLane));
    const opening = start === 0 ? layoutOpening(this.book, this.settings, bodyWidth, bodyHeight, this.measurer) : null;
    const openingSpace = opening ? opening.extent + opening.gap : 0;
    if (vertical) bodyWidth -= openingSpace;
    else bodyHeight -= openingSpace;
    const imageRange = this.index.ranges.find((range) => range.block.kind === 'image' && range.block.image && range.end > start);
    const imagePage = imageRange?.start === start;
    const imageLimit = imageRange
      ? imagePage ? Math.min(this.index.text.length, imageRange.end + 1) : imageRange.start
      : this.index.text.length;
    const end = Math.min(stopAt ?? this.index.text.length, imageLimit,
      continuous ? this.index.text.length : safeWindowEnd(this.index, start, this.windowSize));
    const text = this.index.text.slice(start, end);
    const context = new StoneContext({
      direction: this.settings.direction, fontSize,
      lineHeightScale: this.settings.lineHeight,
      punctuationMode: this.settings.punctuationMode, kinsoku: this.settings.kinsoku,
      dividesByWords: this.settings.dividesByWords, allowsTateChuYoko: this.settings.allowsTateChuYoko,
      textAlign: this.settings.textAlign, directionAlign: this.settings.directionAlign,
      fonts: readerFonts(this.settings),
    }, this.measurer);
    // The progression axis is unlimited. Stone therefore never replaces source text with an ellipsis.
    context.renderSize = vertical ? { width: Infinity, height: bodyHeight } : { width: bodyWidth, height: Infinity };
    const parsed = parseText(text, this.settings.dividesByWords);
    context.runs = parsed.runs;
    context.tokens = parsed.tokens;
    const offsets = runOffsets(context.runs);
    const rubies = rubySpans(this.index, start, end);
    const styles = this.index.ranges.filter((r) => r.block.kind === 'heading' && r.end > start && r.start < end)
      .map((r) => ({ start: Math.max(0, r.start - start), end: r.end - start, fontWeight: 700 }));
    applyFontStyleSpans(context, styles);
    measureRuns(context);
    // Canvas can report a zero advance for the object-replacement character. The
    // image is drawn at 1em, so reserve that same space before layout and wrapping.
    for (const run of context.runs) if (run.char === '\ufffc') run.advance = fontSize;
    layoutBlocks(context, this.index, start, end, offsets, rubies, bodyWidth, bodyHeight);
    let cutoff = continuous ? context.runs.length : context.runs.findIndex((run) => vertical ? run.frame.x < -0.01 : run.frame.y + run.frame.height > bodyHeight + 0.01);
    if (cutoff < 0) cutoff = context.runs.length;
    while (cutoff > 0 && cutoff < context.runs.length && context.runs[cutoff - 1].line === context.runs[cutoff].line) cutoff -= 1;
    let consumed = offsets[cutoff] ?? text.length;
    const cutRuby = rubies.find((ruby) => ruby.start < consumed && consumed < ruby.end);
    if (cutRuby) { consumed = cutRuby.start; cutoff = offsets.findIndex((offset) => offset === consumed); }
    if (text.length > 0 && consumed <= 0) throw new Error('この画面の大きさではルビ付きの本文を1ページに配置できません。文字を小さくするか、画面を広げてください。');
    context.runs = context.runs.slice(0, cutoff);
    context.tokens = context.tokens.filter((token) => token.start < cutoff).map((token) => ({ ...token, end: Math.min(token.end, cutoff) }));
    context.runs.forEach((run) => { run.visibility = 'visible'; });
    // Align only the retained page, after cutting the unlimited layout window.
    // Aligning that whole window would shift later text onto the current page.
    if (!continuous && context.runs.length && this.settings.directionAlign !== 'start') {
      const fraction = this.settings.directionAlign === 'middle' ? 0.5 : 1;
      const low = Math.min(...context.runs.map((run) => vertical ? run.frame.x : run.frame.y));
      const high = Math.max(...context.runs.map((run) => vertical ? run.frame.x + run.frame.width : run.frame.y + run.frame.height));
      const spare = Math.max(0, (vertical ? bodyWidth : bodyHeight) - (high - low));
      for (const run of context.runs) translateRun(run, vertical ? -spare * fraction : 0, vertical ? 0 : spare * fraction);
    }
    const progressionExtent = Math.max(context.lineHeight, context.lineCount * context.lineHeight);
    const bodyExtent = continuous && imagePage ? (vertical ? bodyWidth : bodyHeight) : progressionExtent;
    // Each continuous line occupies exactly one pitch. Put its annotation lane
    // inside that pitch rather than adding a fresh outer margin to every chunk.
    const continuousAnnotationInset = imagePage ? 0 : Math.min(fontSize * 0.6, Math.max(0, context.lineHeight - fontSize));
    if (continuous && vertical) {
      for (const run of context.runs) translateRun(run, bodyExtent - bodyWidth - continuousAnnotationInset, 0);
    }
    const pageEnd = start + consumed;
    const page: ReaderPageData = {
      start: anchorAt(this.index, start), end: anchorAt(this.index, pageEnd),
      globalStart: start, globalEnd: pageEnd, text: this.index.text.slice(start, pageEnd),
      width: continuous && vertical ? bodyExtent + openingSpace : this.width,
      height: continuous && !vertical ? bodyExtent + openingSpace : this.height,
      insetX: vertical ? (continuous ? 0 : margin) : leadingMargin,
      insetY: vertical ? leadingMargin : (continuous ? continuousAnnotationInset : margin + annotationLane) + openingSpace, context,
      glyphs: glyphParagraphs(context).flatMap((paragraph) => paragraph.groups.flatMap((group) => group.glyphs))
        .filter((glyph) => glyph.text !== '\ufffc'),
      rubies: [], emphasis: [], images: [],
      ranges: this.index.ranges.filter((r) => r.end >= start && r.start < pageEnd),
      opening: opening ? {
        ...opening.opening,
        x: vertical ? (continuous ? bodyExtent : margin + bodyWidth) + opening.gap : leadingMargin,
        y: vertical ? leadingMargin : continuous ? 0 : margin + annotationLane,
      } : undefined,
    };
    this.decorate(page, offsets, rubies);
    if (imagePage && imageRange?.block.image) {
      page.glyphs = [];
      page.images = [{ ...imageRange.block.image, x: 0, y: 0, width: bodyWidth, height: bodyHeight }];
    }
    if (rememberPredecessor && pageEnd > start) this.predecessors.set(pageEnd, start);
    if (!continuous) this.cache.set(start, page);
    const limit = this.settings.paginationMode === 'all' ? Infinity : this.settings.paginationMode === 'batch' ? 14 : 3;
    while (this.cache.size > limit) this.cache.delete(this.cache.keys().next().value!);
    return page;
  }

  private decorate(page: ReaderPageData, offsets: number[], rubies: RubySpan[]): void {
    const vertical = this.settings.direction === 'tbRl';
    const f = this.settings.fontSize;
    const parentRuns = (start: number, end: number) => page.context.runs.filter((_, i) => offsets[i] >= start && offsets[i] < end);
    if (this.settings.ruby) for (const ruby of rubies) {
      if (ruby.start < 0 || ruby.end > page.text.length) continue;
      const runs = parentRuns(ruby.start, ruby.end);
      const lines = [...new Set(runs.map((run) => run.line))];
      const reading = splitGraphemes(ruby.reading);
      let used = 0;
      lines.forEach((line, lineIndex) => {
        const group = runs.filter((run) => run.line === line);
        const count = lineIndex === lines.length - 1 ? reading.length - used : Math.round(reading.length * group.length / runs.length);
        const readingOffset = reading.slice(0, used).join('').length;
        const part = reading.slice(used, used + count).join(''); used += count;
        if (!part || !group.length) return;
        const left = Math.min(...group.map((run) => run.frame.x));
        const top = Math.min(...group.map((run) => run.frame.y));
        const right = Math.max(...group.map((run) => run.frame.x + run.frame.width));
        const bottom = Math.max(...group.map((run) => run.frame.y + run.frame.height));
        const rubyContext = new StoneContext({
          direction: this.settings.direction, fontSize: f * 0.5, lineHeightScale: 1,
          kinsoku: false, dividesByWords: false, allowsTateChuYoko: false,
          fonts: readerFonts(this.settings),
        }, this.measurer);
        const parsed = parseText(part, false); rubyContext.runs = parsed.runs; rubyContext.tokens = parsed.tokens;
        measureRuns(rubyContext); new Layouter(rubyContext).layout();
        const size = vertical ? rubyContext.renderedSize.height : rubyContext.renderedSize.width;
        const available = vertical ? bottom - top : right - left;
        // Readings stay within their parent's inline extent: adjacent ruby cannot collide.
        const scale = size > 0 ? Math.min(1, available / size) : 1;
        page.rubies.push({
          key: `${ruby.start}-${line}`, sourceStart: page.globalStart + ruby.start, readingOffset,
          reading: part, glyphs: glyphElements(rubyContext),
          x: vertical ? right + f * 0.08 : left + (available - size * scale) / 2,
          y: vertical ? top + (available - size * scale) / 2 : top - f * 0.6,
          scaleX: vertical ? 1 : scale, scaleY: vertical ? scale : 1,
        });
      });
    }
    for (const range of page.ranges) {
      for (const emphasis of range.block.emphasis) {
        const localStart = range.start + emphasis.start - page.globalStart;
        const localEnd = range.start + emphasis.end - page.globalStart;
        for (const run of parentRuns(localStart, localEnd)) {
          if (run.isNewline || /^\s+$/u.test(run.char)) continue;
          const hasRuby = this.settings.ruby && rubies.some((r) => r.start < localEnd && r.end > localStart);
          const lane = hasRuby ? f * 0.78 : f * 0.18;
          page.emphasis.push({
            x: vertical ? run.frame.x + run.frame.width + lane : run.frame.x + run.frame.width / 2,
            y: vertical ? run.frame.y + run.frame.height / 2 : run.frame.y - lane,
            radius: Math.max(1.2, f * 0.065),
          });
        }
      }
      const images = range.block.kind === 'image' && range.block.image
        ? [{ ...range.block.image, start: 0, end: 1 }]
        : range.block.inlineImages;
      for (const image of images) {
        const run = parentRuns(range.start + image.start - page.globalStart, range.start + image.end - page.globalStart)[0];
        if (!run) continue;
        page.images.push({ src: image.src, alt: image.alt, x: run.frame.x, y: run.frame.y, width: f, height: f });
      }
    }
  }

  previousAnchor(page: ReaderPageData, count: 1 | 2 = 1): Anchor | null {
    if (count === 2) {
      const previous = this.previousAnchor(page);
      return previous ? this.previousAnchor(this.pageAt(previous)) ?? previous : null;
    }
    if (page.globalStart <= 0) return null;
    const known = this.predecessors.get(page.globalStart);
    if (known !== undefined) return anchorAt(this.index, known);
    // Restoration is local: at most a few screens are laid out, even near the end of a long novel.
    let position = safeStart(this.index, Math.max(0, page.globalStart - this.windowSize));
    let previous = position;
    while (position < page.globalStart) {
      previous = position;
      const candidate = this.pageAtPosition(position, page.globalStart);
      if (candidate.globalEnd <= position) break;
      position = candidate.globalEnd;
    }
    this.predecessors.set(page.globalStart, previous);
    return anchorAt(this.index, previous);
  }
}
