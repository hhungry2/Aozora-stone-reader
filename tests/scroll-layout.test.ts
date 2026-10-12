import { describe, expect, it } from 'vitest';
import { FixedMeasurer, splitGraphemes } from '@non-standardworld/stone-engine.js';
import { anchorAt, indexBook, positionOf } from '../src/reader/engine';
import { ScrollLayoutEngine, SCROLL_CHUNK_SOURCE_LIMIT, SCROLL_LAYOUT_CACHE_LIMIT } from '../src/reader/scrollLayout';
import { createAnatomy } from '../src/reader/anatomy';
import { defaultSettings, type Book, type TextBlock } from '../src/types';

function fixture(blocks: Partial<TextBlock>[]): Book {
  return {
    id: 'scroll-fixture', title: '', titleKana: '', subtitle: '', authors: [], authorLabel: '',
    cardUrl: '', dataPath: '', contentVersion: '1', characterCount: 0, excerpt: '', features: [],
    schemaVersion: 1, blocks: blocks.map((block, i) => ({
      id: `p${i}`, kind: 'paragraph', text: '', rubies: [], emphasis: [], inlineImages: [], indent: 0, ...block,
    })), toc: [], credits: '', source: { url: '', fetchedAt: '', sha256: '', encoding: 'UTF-8' },
    conversion: { version: '', warnings: [] },
  };
}

for (const direction of ['tbRl', 'lrTb'] as const) describe(`continuous SVG ${direction}`, () => {
  it('uses the actual line extent rather than leaving a page-sized gap between paragraphs', () => {
    const book = fixture([{ text: '第一段落。' }, { text: '第二段落。' }]);
    const engine = new ScrollLayoutEngine(book, { ...defaultSettings, direction }, 640, 480);
    expect(engine.chunks).toHaveLength(1);
    const page = engine.layoutChunk(0);
    expect(page.text).toBe('第一段落。\n第二段落。');
    expect(direction === 'tbRl' ? page.width : page.height).toBeCloseTo(2 * 20 * defaultSettings.lineHeight);
    const first = page.context.runs.find((run) => run.char === '第')!;
    const next = page.context.runs.find((run) => run.char === '第' && run !== first)!;
    expect(Math.abs(direction === 'tbRl' ? first.frame.x - next.frame.x : next.frame.y - first.frame.y)).toBeCloseTo(38);
  });

  it('lays out all lines in a chunk and paints the opening exactly once', () => {
    const book = fixture(Array.from({ length: 20 }, () => ({ text: '本文の文字と組版。'.repeat(50) })));
    book.title = '作品名'; book.subtitle = '副題'; book.authorLabel = '著者';
    const engine = new ScrollLayoutEngine(book, { ...defaultSettings, direction }, 240, 280);
    const pages = engine.chunks.map((chunk) => engine.layoutChunk(chunk.index));
    expect(pages.map((page) => page.text).join('')).toBe(engine.index.text);
    expect(pages.filter((page) => page.opening)).toHaveLength(1);
    expect(pages[0].opening?.title).toBe('作品名');
    expect(pages[0].context.runs.length).toBeGreaterThan(1000);
    expect(direction === 'tbRl' ? pages[0].width : pages[0].height).toBeGreaterThan(direction === 'tbRl' ? 240 : 280);
    for (const page of pages) {
      expect(page.context.runs.map((run) => run.char).join('')).toBe(page.text);
      expect(page.context.runs.every((run) => run.visibility === 'visible')).toBe(true);
      expect(page.globalStart).toBe(engine.chunks[engine.chunkAtPosition(page.globalStart)].start);
      expect(positionOf(engine.index, page.start)).toBe(page.globalStart);
      expect(positionOf(engine.index, page.end)).toBe(page.globalEnd);
    }
  });

  it('preserves heading weight, indentation, ruby, emphasis, and inline images', () => {
    const book = fixture([
      { kind: 'heading', text: '章題' },
      { text: '　漢字に傍点と画像\ufffc。', indent: 2,
        rubies: [{ start: 1, end: 3, reading: 'かんじ' }],
        emphasis: [{ start: 4, end: 6, kind: 'sesame' }],
        inlineImages: [{ start: 9, end: 10, src: 'image.png', alt: '挿絵', sourceUrl: '' }],
      },
    ]);
    const engine = new ScrollLayoutEngine(book, { ...defaultSettings, direction }, 320, 370);
    const page = engine.layoutChunk(0);
    expect(page.glyphs.find((glyph) => glyph.text === '章')?.fontWeight).toBe(700);
    expect(page.rubies.map((ruby) => ruby.reading).join('')).toBe('かんじ');
    expect(page.rubies[0].sourceStart).toBe(engine.index.ranges[1].start + 1);
    expect(page.emphasis).toHaveLength(2);
    expect(page.images).toHaveLength(1);
    const body = page.context.runs.find((run) => run.char === '漢')!;
    expect(direction === 'tbRl' ? body.frame.y : body.frame.x).toBeGreaterThan(20);
  });

  it('keeps body and ruby frames within the progression extent and joins chunks at one line pitch', () => {
    const text = '漢字'.repeat(600);
    const book = fixture(Array.from({ length: 4 }, () => ({
      text, rubies: [{ start: 0, end: 2, reading: 'かんじ' }, { start: text.length - 2, end: text.length, reading: 'かんじ' }],
    })));
    const engine = new ScrollLayoutEngine(book, { ...defaultSettings, direction }, 320, 370);
    const pages = engine.chunks.map((chunk) => engine.layoutChunk(chunk.index));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const extent = direction === 'tbRl' ? page.width : page.height;
      for (const run of page.context.runs) {
        const low = direction === 'tbRl' ? page.insetX + run.frame.x : page.insetY + run.frame.y;
        const high = low + (direction === 'tbRl' ? run.frame.width : run.frame.height);
        expect(low).toBeGreaterThanOrEqual(-0.01);
        expect(high).toBeLessThanOrEqual(extent + 0.01);
      }
      for (const ruby of page.rubies) for (const glyph of ruby.glyphs) {
        const low = direction === 'tbRl'
          ? page.insetX + ruby.x + glyph.run.frame.x * ruby.scaleX
          : page.insetY + ruby.y + glyph.run.frame.y * ruby.scaleY;
        const high = low + (direction === 'tbRl' ? glyph.run.frame.width * ruby.scaleX : glyph.run.frame.height * ruby.scaleY);
        expect(low).toBeGreaterThanOrEqual(-0.01);
        expect(high).toBeLessThanOrEqual(extent + 0.01);
      }
    }
    for (let i = 0; i + 1 < pages.length; i++) {
      const previous = pages[i];
      const next = pages[i + 1];
      const last = previous.context.runs.filter((run) => !run.isNewline).at(-1)!;
      const first = next.context.runs.find((run) => !run.isNewline)!;
      const pitch = direction === 'tbRl'
        ? next.width + previous.insetX + last.frame.x - next.insetX - first.frame.x
        : previous.height + next.insetY + first.frame.y - previous.insetY - last.frame.y;
      expect(pitch).toBeCloseTo(defaultSettings.fontSize * defaultSettings.lineHeight);
    }
  });

  it('keeps graphemes and ordinary ruby parents intact across huge-paragraph partitions', () => {
    const prefix = 'あ'.repeat(SCROLL_CHUNK_SOURCE_LIMIT - 3);
    const parent = '長い親文字';
    const book = fixture([{ text: prefix + '𠮷か\u3099' + parent + '後続。'.repeat(1600),
      rubies: [{ start: prefix.length + 4, end: prefix.length + 4 + parent.length, reading: 'ながいおやもじ' }],
    }]);
    const engine = new ScrollLayoutEngine(book, { ...defaultSettings, direction }, 240, 280);
    const boundaries = new Set<number>();
    let offset = 0; boundaries.add(offset);
    for (const char of splitGraphemes(engine.index.text)) { offset += char.length; boundaries.add(offset); }
    for (const chunk of engine.chunks) {
      expect(boundaries.has(chunk.start)).toBe(true);
      expect(boundaries.has(chunk.end)).toBe(true);
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(SCROLL_CHUNK_SOURCE_LIMIT);
      const ruby = book.blocks[0].rubies[0];
      expect(chunk.end > ruby.start && chunk.end < ruby.end).toBe(false);
    }
    const pages = engine.chunks.map((chunk) => engine.layoutChunk(chunk.index));
    expect(pages.map((page) => page.text).join('')).toBe(engine.index.text);
    expect(pages.flatMap((page) => page.rubies).map((ruby) => ruby.reading).join('')).toBe('ながいおやもじ');
  });

  it('divides an exceptionally long ruby without losing reading or source identity', () => {
    const parent = '漢'.repeat(6500);
    const reading = 'か\u3099𠮷ん'.repeat(2000);
    const book = fixture([{ text: parent, rubies: [{ start: 0, end: parent.length, reading }] }]);
    const engine = new ScrollLayoutEngine(book, { ...defaultSettings, direction }, 240, 280);
    expect(engine.chunks.length).toBeGreaterThan(3);
    const pages = engine.chunks.map((chunk) => engine.layoutChunk(chunk.index));
    expect(pages.map((page) => page.text).join('')).toBe(parent);
    const rubies = pages.flatMap((page) => page.rubies);
    expect(rubies.map((ruby) => ruby.reading).join('')).toBe(reading);
    let offset = 0;
    for (const ruby of rubies) {
      expect(ruby.sourceStart).toBe(0);
      expect(ruby.readingOffset).toBe(offset);
      offset += ruby.reading.length;
    }
    expect(createAnatomy(pages[1]).rubies.length).toBeGreaterThan(0);
    expect(createAnatomy(pages[1]).rubies[0].sourceStart).toBe(0);
  });
});

it('indexes a million-character book without measuring it, and lays out a late anchor with bounded work', () => {
  const book = fixture(Array.from({ length: 5000 }, () => ({ text: '長編小説の本文。'.repeat(30) })));
  const measurer = new FixedMeasurer();
  let calls = 0;
  const originalAdvance = measurer.advance.bind(measurer);
  measurer.advance = (...args) => { calls += 1; return originalAdvance(...args); };
  const engine = new ScrollLayoutEngine(book, { ...defaultSettings, paginationMode: 'all' }, 640, 480, measurer);
  expect(engine.index.text.length).toBeGreaterThan(1_000_000);
  expect(calls).toBe(0);
  expect(engine.cacheSize).toBe(0);
  const position = engine.index.ranges[4900].start + 30;
  const chunkIndex = engine.chunkAtAnchor(anchorAt(engine.index, position));
  const page = engine.layoutChunk(chunkIndex);
  expect(page.globalStart).toBeLessThanOrEqual(position);
  expect(page.globalEnd).toBeGreaterThan(position);
  expect(page.context.runs.length).toBeLessThanOrEqual(SCROLL_CHUNK_SOURCE_LIMIT);
  expect(calls).toBeLessThan(4000);
  expect(engine.cacheSize).toBe(1);
  expect(engine.layoutChunk(chunkIndex)).toBe(page);
  for (let i = 0; i < SCROLL_LAYOUT_CACHE_LIMIT + 5; i++) engine.layoutChunk(i);
  expect(engine.cacheSize).toBe(SCROLL_LAYOUT_CACHE_LIMIT);
});

it('isolates block images and preserves all neighboring source separators', () => {
  const engine = new ScrollLayoutEngine(fixture([
    { text: '画像の前。' },
    { kind: 'image', image: { src: 'image.png', alt: '風景', sourceUrl: '' } },
    { text: '画像の後。' },
  ]), defaultSettings, 320, 370);
  const pages = engine.chunks.map((chunk) => engine.layoutChunk(chunk.index));
  expect(pages).toHaveLength(3);
  expect(pages.map((page) => page.text).join('')).toBe(engine.index.text);
  expect(pages[1].images[0]).toMatchObject({ src: 'image.png', alt: '風景' });
  expect(pages[1].glyphs).toHaveLength(0);
});

it('locates exact chunk boundaries in logarithmic order and supports empty books', () => {
  const engine = new ScrollLayoutEngine(fixture([{ text: '本文。'.repeat(4000) }]), defaultSettings, 320, 370);
  for (const chunk of engine.chunks) {
    expect(engine.chunkAtPosition(chunk.start)).toBe(chunk.index);
    expect(engine.chunkAtPosition(chunk.end - 1)).toBe(chunk.index);
  }
  expect(engine.chunkAtPosition(engine.index.text.length)).toBe(engine.chunks.length - 1);
  expect(engine.chunkAtPosition(-100)).toBe(0);
  const empty = new ScrollLayoutEngine(fixture([]), defaultSettings, 320, 370);
  expect(empty.chunks).toHaveLength(1);
  expect(empty.layoutChunk(0).text).toBe('');
});

it('resolves binary source anchors exactly across empty blocks and paragraph separators', () => {
  const index = indexBook(fixture([{ text: '' }, { text: '本文𠮷。' }, { text: '' }, { text: '末尾' }, { text: '' }]));
  // Keep the original linear definition as an independent reference for every
  // UTF-16 position, including separators and empty paragraphs.
  for (let position = -2; position <= index.text.length + 2; position++) {
    const clamped = Math.max(0, Math.min(index.text.length, position));
    const range = index.ranges.find((item) => clamped <= item.end) ?? index.ranges.at(-1);
    const expected = {
      blockId: range?.block.id ?? '',
      offset: range ? Math.min(clamped - range.start, range.end - range.start) : 0,
      context: range ? index.text.slice(clamped, Math.min(clamped + 32, range.end)) : '',
    };
    expect(anchorAt(index, position)).toEqual(expected);
    expect(positionOf(index, anchorAt(index, position))).toBe(clamped);
  }
  expect(anchorAt(indexBook(fixture([])), 100)).toEqual({ blockId: '', offset: 0, context: '' });
});
