import { describe, expect, it } from 'vitest';
import { FixedMeasurer, splitGraphemes } from '@non-standardworld/stone-engine.js';
import { anchorAt, indexBook, PaginationEngine, positionOf } from '../src/reader/engine';
import { defaultSettings, type Book, type TextBlock } from '../src/types';

function fixture(blocks: Partial<TextBlock>[]): Book {
  return {
    id: 'fixture', title: '試験', titleKana: '', subtitle: '', authors: [], authorLabel: '',
    cardUrl: '', dataPath: '', contentVersion: '1', characterCount: 0, excerpt: '', features: [],
    schemaVersion: 1, blocks: blocks.map((block, i) => ({
      id: `p${i}`, kind: 'paragraph', text: '', rubies: [], emphasis: [], inlineImages: [], indent: 0, ...block,
    })), toc: [], credits: '', source: { url: '', fetchedAt: '', sha256: '', encoding: 'UTF-8' },
    conversion: { version: '', warnings: [] },
  };
}

for (const direction of ['tbRl', 'lrTb'] as const) describe(`Stone pagination ${direction}`, () => {
  it('joins all page ranges exactly, preserving spaces, blank lines, supplementary glyphs, marks and ruby', () => {
    const sentence = '　「雨。」一寸待て。12月には、𠮷野のか\u3099き\u{E0100}を食べる……。\n\n';
    const text = sentence.repeat(90);
    const rubies = Array.from({ length: 90 }, (_, i) => ({ start: i * sentence.length + 5, end: i * sentence.length + 7, reading: 'ちょっと' }));
    const book = fixture([{ text, rubies }, { kind: 'heading', text: '二' }, { text: ' \n末尾。\n　 ' }]);
    const engine = new PaginationEngine(book, { ...defaultSettings, direction }, 320, 370, new FixedMeasurer());
    const expected = indexBook(book).text;
    const boundaries = new Set<number>([0]);
    let boundary = 0;
    for (const glyph of splitGraphemes(expected)) { boundary += glyph.length; boundaries.add(boundary); }
    let source = '';
    let at = 0;
    let pageCount = 0;
    while (at < expected.length) {
      const page = engine.pageAtPosition(at);
      expect(page.globalStart).toBe(at);
      expect(page.globalEnd).toBeGreaterThan(at);
      expect(boundaries.has(page.globalEnd)).toBe(true);
      expect(page.context.runs.every((run) => run.visibility === 'visible')).toBe(true);
      expect(page.context.text).toBe(page.text);
      for (const ruby of rubies) expect(page.globalEnd > ruby.start && page.globalEnd < ruby.end).toBe(false);
      source += page.text;
      at = page.globalEnd;
      expect(++pageCount).toBeLessThan(500);
      expect(engine.cacheSize).toBeLessThanOrEqual(3);
    }
    expect(source).toBe(expected);
    expect(pageCount).toBeGreaterThan(5);
  });

  it('keeps the UTF-16 anchor when direction, font size, and viewport change', () => {
    const book = fixture([{ text: '日本文学のページ。'.repeat(400) }]);
    const index = indexBook(book);
    const anchor = anchorAt(index, 1432);
    for (const fontSize of [16, 24, 36]) {
      const engine = new PaginationEngine(book, { ...defaultSettings, direction, fontSize }, 320, 500, new FixedMeasurer());
      const page = engine.pageAt(anchor);
      expect(page.globalStart).toBe(positionOf(index, anchor));
      expect(page.start).toEqual(anchor);
    }
  });

  it('returns to the same boundary after next and previous, including restored positions', () => {
    const book = fixture([{ text: '石の組版。文学の扉。'.repeat(1800) }]);
    const engine = new PaginationEngine(book, { ...defaultSettings, direction }, 640, 480, new FixedMeasurer());
    const restored = engine.pageAtPosition(12001);
    const previous = engine.previousAnchor(restored);
    expect(previous).not.toBeNull();
    const previousPage = engine.pageAt(previous);
    expect(previousPage.globalEnd).toBe(restored.globalStart);
    const next = engine.pageAt(restored.end);
    expect(engine.previousAnchor(next)).toEqual(restored.start);
  });

  it('keeps ruby readings within their parent interval and separates emphasis lanes', () => {
    const book = fixture([{ text: '日日日日', rubies: [
      { start: 0, end: 1, reading: 'たいへんながいよみ' }, { start: 1, end: 2, reading: 'つぎのよみかた' },
    ], emphasis: [{ start: 0, end: 4, kind: 'sesame' }] }]);
    const engine = new PaginationEngine(book, { ...defaultSettings, direction }, 320, 370, new FixedMeasurer());
    const page = engine.pageAtPosition(0);
    expect(page.rubies).toHaveLength(2);
    const first = page.rubies[0];
    const second = page.rubies[1];
    const extent = (ruby: typeof first) => Math.max(...ruby.glyphs.map((glyph) => direction === 'tbRl'
      ? ruby.y + (glyph.run.frame.y + glyph.run.frame.height) * ruby.scaleY
      : ruby.x + (glyph.run.frame.x + glyph.run.frame.width) * ruby.scaleX));
    expect(extent(first)).toBeLessThanOrEqual((direction === 'tbRl' ? second.y : second.x) + 0.01);
    expect(page.emphasis).toHaveLength(4);
  });

  it('uses a bounded layout window for long novels and renders inline gaiji as images', () => {
    const book = fixture([{ text: '長編文学。'.repeat(100000) }, {
      text: '外字\ufffc。', inlineImages: [{ start: 2, end: 3, src: 'data/assets/test.png', alt: '外字の説明', sourceUrl: '' }],
    }]);
    const engine = new PaginationEngine(book, { ...defaultSettings, direction }, 320, 370, new FixedMeasurer());
    const first = engine.pageAtPosition(0);
    expect(first.context.runs.length).toBeLessThan(1000);
    const lastBlock = engine.pageAt({ blockId: 'p1', offset: 0, context: '外字' });
    expect(lastBlock.images).toHaveLength(1);
    expect(lastBlock.glyphs.some((glyph) => glyph.text === '\ufffc')).toBe(false);
    expect(lastBlock.text).toBe('外字\ufffc。');
    expect(engine.windowSize).toBeLessThanOrEqual(12000);
  });

  it('reserves a full character for an image even when the font measures its placeholder at zero', () => {
    const fixed = new FixedMeasurer();
    const measurer = {
      advance: (...args: Parameters<FixedMeasurer['advance']>) => args[2] === '\ufffc' ? 0 : fixed.advance(...args),
      metrics: fixed.metrics.bind(fixed),
    };
    const book = fixture([{
      text: '\ufffc陀多と云う男。',
      inlineImages: [{ start: 0, end: 1, src: 'data/assets/test.png', alt: '外字', sourceUrl: '' }],
      rubies: [{ start: 0, end: 3, reading: 'かんだた' }],
    }]);
    const page = new PaginationEngine(book, { ...defaultSettings, direction, fontSize: 28 }, 320, 370, measurer).pageAtPosition(0);
    const [placeholder, next] = page.context.runs;
    const image = page.images[0];
    expect(placeholder.advance).toBe(28);
    expect(placeholder.line).toBe(next.line);
    if (direction === 'tbRl') {
      expect(placeholder.frame.height).toBe(28);
      expect(image.y + image.height).toBeLessThanOrEqual(next.frame.y);
    } else {
      expect(placeholder.frame.width).toBe(28);
      expect(image.x + image.width).toBeLessThanOrEqual(next.frame.x);
    }
    expect(page.text).toBe(book.blocks[0].text);
    expect(page.rubies[0].reading).toBe('かんだた');
  });

  it('gives standalone illustrations a page while keeping every separator', () => {
    const book = fixture([{ text: '挿絵の前。' }, {
      kind: 'image', text: '\ufffc', image: { src: 'data/assets/picture.png', alt: '山の挿絵', sourceUrl: '' },
    }, { text: '挿絵の後。' }]);
    const engine = new PaginationEngine(book, { ...defaultSettings, direction }, 320, 370, new FixedMeasurer());
    const first = engine.pageAtPosition(0);
    expect(first.text).toBe('挿絵の前。\n');
    const picture = engine.pageAt(first.end);
    expect(picture.text).toBe('\ufffc\n');
    expect(picture.images).toHaveLength(1);
    expect(picture.images[0].width).toBeGreaterThan(200);
    expect(picture.glyphs).toHaveLength(0);
    const last = engine.pageAt(picture.end);
    expect(first.text + picture.text + last.text).toBe(indexBook(book).text);
  });

  it('indents every line of a block without adding source spaces or doubling existing spaces', () => {
    const text = '字下げを維持する本文。'.repeat(15);
    const book = fixture([{ text, indent: 2 }]);
    const engine = new PaginationEngine(book, { ...defaultSettings, direction }, 320, 370, new FixedMeasurer());
    const page = engine.pageAtPosition(0);
    const starts = [...new Set(page.context.runs.map((run) => run.line))].map((line) => page.context.runs.find((run) => run.line === line)!);
    for (const run of starts) expect(direction === 'tbRl' ? run.frame.y : run.frame.x).toBeCloseTo(40);
    expect(page.context.text).toBe(page.text);
    const alreadyIndented = new PaginationEngine(fixture([{ text: `　　${text}`, indent: 2 }]), { ...defaultSettings, direction }, 320, 370, new FixedMeasurer());
    const firstGlyph = alreadyIndented.pageAtPosition(0).context.runs[2];
    expect(direction === 'tbRl' ? firstGlyph.frame.y : firstGlyph.frame.x).toBeCloseTo(40);
  });
});
