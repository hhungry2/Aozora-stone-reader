import {
  FixedMeasurer, isNotEndingChar, isNotStartingChar, splitGraphemes,
  type FontMeasurer,
} from '@non-standardworld/stone-engine.js';
import type { Anchor, Book, ReaderSettings, RubyRange } from '../types';
import {
  indexBook, PaginationEngine, positionOf,
  type BookIndex, type BookRange, type ReaderPageData,
} from './engine';

/** Source descriptors are cheap; measured runs exist only in the small LRU. */
export interface ScrollChunk {
  index: number;
  start: number;
  end: number;
  estimatedExtent: number;
}

export const SCROLL_CHUNK_SOURCE_LIMIT = 2000;
export const SCROLL_LAYOUT_CACHE_LIMIT = 7;

function graphemeBoundary(text: string, position: number): number {
  const target = Math.max(0, Math.min(text.length, position));
  if (target === text.length || target === 0) return target;
  let from = Math.max(0, target - 64);
  if (from && /[\uDC00-\uDFFF]/u.test(text[from])) from -= 1;
  let offset = from;
  for (const char of splitGraphemes(text.slice(from, Math.min(text.length, target + 64)))) {
    if (offset + char.length > target) return offset;
    offset += char.length;
    if (offset === target) return target;
  }
  return target;
}

/** Keep ordinary ruby intact; very large parents are divided with their readings. */
function splitEnd(text: string, range: BookRange, start: number, limit: number, kinsoku: boolean): number {
  const endOfBlock = range.end;
  let end = graphemeBoundary(text, Math.min(endOfBlock, start + limit));
  // A source newline already begins a new line. Prefer it near the target so an
  // unusually long paragraph does not acquire an unnecessary extra wrap there.
  const newline = text.lastIndexOf('\n', end - 1);
  if (newline >= start + limit * 0.6) end = newline + 1;
  const local = end - range.start;
  const ruby = range.block.rubies.find((item) => item.start < local && local < item.end);
  if (ruby && ruby.end - ruby.start <= limit) {
    end = range.start + ruby.start;
    if (end <= start) end = range.start + ruby.end;
  }
  if (kinsoku && end < endOfBlock) {
    // Back up a bounded amount so an emergency chunk boundary has the same
    // forbidden-head/forbidden-tail guarantees as an ordinary wrapped line.
    const chars = splitGraphemes(text.slice(Math.max(start, end - 64), Math.min(endOfBlock, end + 64)));
    let at = Math.max(start, end - 64);
    const boundaries = chars.map((char) => { const entry = { char, at }; at += char.length; return entry; });
    let current = boundaries.findIndex((entry) => entry.at === end);
    while (current > 0 && (
      isNotStartingChar(boundaries[current].char) || isNotEndingChar(boundaries[current - 1].char)
    )) { current -= 1; end = boundaries[current].at; }
  }
  if (end <= start) end = start + (splitGraphemes(text.slice(start, start + 64))[0]?.length ?? 1);
  // A kinsoku adjustment must not introduce a cut through a normal ruby.
  const adjustedRuby = range.block.rubies.find((item) => range.start + item.start < end && end < range.start + item.end);
  if (adjustedRuby && adjustedRuby.end - adjustedRuby.start <= limit) {
    end = range.start + adjustedRuby.start;
    if (end <= start) end = range.start + adjustedRuby.end;
  }
  return Math.min(endOfBlock, end);
}

interface RubyIdentity { start: number; originalStart: number; readingOffset: number }

function clippedRuby(ruby: RubyRange, from: number, to: number): { ruby: RubyRange; readingOffset: number } {
  const start = Math.max(from, ruby.start);
  const end = Math.min(to, ruby.end);
  const length = ruby.end - ruby.start;
  const readingStart = graphemeBoundary(ruby.reading, Math.floor(ruby.reading.length * (start - ruby.start) / length));
  const readingEnd = end === ruby.end ? ruby.reading.length
    : graphemeBoundary(ruby.reading, Math.floor(ruby.reading.length * (end - ruby.start) / length));
  return { ruby: { start, end, reading: ruby.reading.slice(readingStart, readingEnd) }, readingOffset: readingStart };
}

/**
 * Continuous SVG layout keeps a lightweight source index for the whole work and
 * measures only requested paragraph chunks. Cache policy never follows the page
 * reader's full-book preparation option.
 */
export class ScrollLayoutEngine {
  readonly index: BookIndex;
  readonly chunks: ScrollChunk[] = [];
  private readonly cache = new Map<number, ReaderPageData>();
  private readonly firstRanges: number[] = [];
  private readonly lastRanges: number[] = [];

  constructor(
    readonly book: Book,
    readonly settings: ReaderSettings,
    readonly width: number,
    readonly height: number,
    readonly measurer: FontMeasurer = new FixedMeasurer(),
  ) {
    this.index = indexBook(book);
    let pendingStart = 0;
    let pendingFirst = 0;
    let pendingLast = 0;
    let pendingLength = 0;
    const flush = (end: number) => {
      if (end <= pendingStart && this.chunks.length) return;
      const chunk = { index: this.chunks.length, start: pendingStart, end, estimatedExtent: 0 };
      this.firstRanges.push(pendingFirst);
      this.lastRanges.push(pendingLast);
      chunk.estimatedExtent = this.estimate(pendingStart, end, pendingFirst, pendingLast);
      this.chunks.push(chunk);
      pendingStart = end;
      pendingLength = 0;
    };
    this.index.ranges.forEach((range, rangeIndex) => {
      const end = Math.min(this.index.text.length, range.end + 1);
      const length = end - range.start;
      const image = range.block.kind === 'image' && Boolean(range.block.image);
      if (pendingLength && (image || pendingLength + length > SCROLL_CHUNK_SOURCE_LIMIT)) flush(range.start);
      if (!pendingLength) { pendingStart = range.start; pendingFirst = rangeIndex; }
      pendingLast = rangeIndex;
      if (image) {
        flush(end);
        return;
      }
      let partStart = range.start;
      while (end - partStart > SCROLL_CHUNK_SOURCE_LIMIT) {
        const partEnd = splitEnd(this.index.text, range, partStart, SCROLL_CHUNK_SOURCE_LIMIT, settings.kinsoku);
        flush(partEnd);
        partStart = partEnd;
        pendingFirst = rangeIndex;
      }
      pendingLength = end - pendingStart;
    });
    if (pendingLength || !this.chunks.length) flush(this.index.text.length);
  }

  get cacheSize(): number { return this.cache.size; }

  chunkAtPosition(position: number): number {
    const target = Math.max(0, Math.min(this.index.text.length, position));
    let low = 0;
    let high = this.chunks.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.chunks[middle].end <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  chunkAtAnchor(anchor: Anchor | null): number {
    return this.chunkAtPosition(positionOf(this.index, anchor));
  }

  layoutChunk(index: number): ReaderPageData {
    const chunk = this.chunks[index];
    if (!chunk) throw new RangeError(`Unknown scroll chunk: ${index}`);
    const cached = this.cache.get(index);
    if (cached) { this.cache.delete(index); this.cache.set(index, cached); return cached; }
    const identities: RubyIdentity[] = [];
    // The shared source string is not copied. Only intersecting block metadata is
    // visited, so laying out a late chunk does not scan every preceding paragraph.
    // One following range lets the end anchor resolve a separator to the next
    // paragraph's offset zero. It contributes no runs outside the source window.
    const ranges = this.index.ranges.slice(this.firstRanges[index], this.lastRanges[index] + 2).map((range) => {
      const from = Math.max(0, chunk.start - range.start);
      const to = Math.min(range.end - range.start, chunk.end - range.start);
      const rubies = range.block.rubies.filter((ruby) => ruby.end > from && ruby.start < to).map((ruby) => {
        const clipped = clippedRuby(ruby, from, to);
        identities.push({ start: range.start + clipped.ruby.start, originalStart: range.start + ruby.start, readingOffset: clipped.readingOffset });
        return clipped.ruby;
      });
      return { ...range, block: { ...range.block, rubies } };
    });
    const scopedIndex = { text: this.index.text, ranges };
    const engine = new PaginationEngine(this.book, this.settings, this.width, this.height, this.measurer, scopedIndex);
    const page = engine.layoutContinuousRange(chunk.start, chunk.end);
    for (const ruby of page.rubies) {
      const identity = identities.find((item) => item.start === ruby.sourceStart);
      if (identity) {
        const line = ruby.key.slice(ruby.key.lastIndexOf('-') + 1);
        ruby.sourceStart = identity.originalStart;
        ruby.readingOffset += identity.readingOffset;
        ruby.key = `${identity.originalStart - page.globalStart}-${line}`;
      }
    }
    // Inspection needs the original parent span even when an extreme ruby was
    // divided to keep the measured source window bounded.
    page.ranges = this.index.ranges.slice(this.firstRanges[index], this.lastRanges[index] + 1)
      .filter((range) => range.end >= page.globalStart && range.start < page.globalEnd);
    this.cache.set(index, page);
    while (this.cache.size > SCROLL_LAYOUT_CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    return page;
  }

  private estimate(start: number, end: number, first: number, last: number): number {
    const vertical = this.settings.direction === 'tbRl';
    const fontSize = this.settings.fontSize;
    const inline = Math.max(fontSize * 2, (vertical ? this.height : this.width) - fontSize * 1.7);
    const cells = Math.max(2, inline / fontSize);
    let lines = 0;
    for (let i = first; i <= last; i++) {
      const range = this.index.ranges[i];
      if (!range) continue;
      if (range.block.kind === 'image' && range.block.image) return Math.max(fontSize * this.settings.lineHeight, vertical ? this.width : this.height);
      const text = this.index.text.slice(Math.max(start, range.start), Math.min(end, range.end));
      const paragraphs = text.split('\n');
      for (const paragraph of paragraphs) lines += Math.max(1, Math.ceil(paragraph.length / cells));
    }
    const opening = start === 0 ? fontSize * this.settings.lineHeight * 4 : 0;
    return Math.max(1, lines) * fontSize * this.settings.lineHeight + opening;
  }
}
