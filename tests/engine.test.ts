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
  it('places work information before the opening passage without changing source anchors', () => {
    const book = fixture([{ text: '　元の本文を保つ。'.repeat(80) }]);
    book.title = '作品の題名';
    book.subtitle = '作品の副題';
    book.authorLabel = '著者名';
    const engine = new PaginationEngine(book, { ...defaultSettings, direction }, 320, 370);
    const first = engine.pageAtPosition(0);
    const opening = first.opening!;
    expect(opening).toMatchObject({ title: book.title, subtitle: book.subtitle, author: book.authorLabel });
    expect(opening.glyphs.map((glyph) => glyph.text).join('')).toBe(book.title + book.subtitle + book.authorLabel);
    expect(first.start).toMatchObject({ blockId: 'p0', offset: 0 });
    expect(first.text).toBe(book.blocks[0].text.slice(0, first.globalEnd));
    if (direction === 'tbRl') {
      const bodyRight = first.insetX + Math.max(...first.context.runs.map((run) => run.frame.x + run.frame.width));
      expect(bodyRight).toBeLessThan(opening.x);
    } else {
      const openingBottom = opening.y + opening.scale * Math.max(...opening.glyphs.map((glyph) => glyph.run.frame.y + glyph.run.frame.height));
      expect(openingBottom).toBeLessThan(first.insetY);
    }
    const next = engine.pageAt(first.end);
    expect(next.opening).toBeUndefined();
    expect(next.start).toEqual(first.end);
    expect(engine.previousAnchor(next)).toEqual(first.start);
    expect(new PaginationEngine(book, { ...defaultSettings, direction }, 640, 480).pageAt(next.start).start).toEqual(next.start);
  });

  it('turns consecutive two-page spreads without dropping or repeating source text', () => {
    const book = fixture([{ text: '　「見開き。」日本語 12月。\n'.repeat(60) }]);
    const engine = new PaginationEngine(book, { ...defaultSettings, direction }, 320, 370);
    let anchor = null as ReturnType<typeof anchorAt> | null;
    let text = '';
    let turns = 0;
    while (text.length < engine.index.text.length) {
      const pages = engine.pagesAt(anchor, 2);
      expect(pages[0].globalStart).toBe(text.length);
      if (pages.length === 2) expect(pages[1].globalStart).toBe(pages[0].globalEnd);
      const last = pages[pages.length - 1];
      const previousStart = text.length;
      text += pages.map(page => page.text).join('');
      if (last.globalEnd < engine.index.text.length) {
        const next = engine.pagesAt(last.end, 2);
        expect(positionOf(engine.index, engine.previousAnchor(next[0], 2))).toBe(previousStart);
      }
      anchor = last.end;
      turns += 1;
    }
    expect(turns).toBeGreaterThan(2);
    expect(text).toBe(engine.index.text);
    const final = engine.pagesAt(anchorAt(engine.index, engine.index.text.length - 1), 2);
    expect(final).toHaveLength(1);
    expect(final[0].globalEnd).toBe(engine.index.text.length);
  });

  it('changes punctuation cell widths and keeps kinsoku optional', () => {
    const book = fixture([{ text: '「日本語」。' }]);
    const whole = new PaginationEngine(book, { ...defaultSettings, direction, punctuationMode: 'whole' }, 320, 370).pageAtPosition(0);
    const half = new PaginationEngine(book, { ...defaultSettings, direction, punctuationMode: 'half' }, 320, 370).pageAtPosition(0);
    const axis = direction === 'tbRl' ? 'height' : 'width';
    expect(whole.context.runs[0].frame[axis]).toBeCloseTo(20);
    expect(half.context.runs[0].frame[axis]).toBeCloseTo(10);
    const shortLine = fixture([{ text: 'あああ。次' }]);
    // Fit three 20px cells after the leading and trailing paint insets.
    const pages = [false, true].map((kinsoku) => new PaginationEngine(shortLine, {
      ...defaultSettings, direction, punctuationMode: 'whole', dividesByWords: false, kinsoku,
    }, direction === 'tbRl' ? 200 : 82, direction === 'tbRl' ? 82 : 200).pageAtPosition(0));
    expect(pages[0].context.runs[3].line).toBeGreaterThan(pages[0].context.runs[2].line);
    expect(pages[1].context.runs[3].line).toBe(pages[1].context.runs[2].line);
  });

  it('positions short text at the selected inline and page alignment', () => {
    const book = fixture([{ text: '短い文' }]);
    const coordinate = direction === 'tbRl' ? 'y' : 'x';
    const inline = ['leading', 'center', 'trailing'].map((textAlign) => new PaginationEngine(book, {
      ...defaultSettings, direction, textAlign: textAlign as 'leading' | 'center' | 'trailing',
    }, 320, 370).pageAtPosition(0));
    const positions = inline.map((page) => page.context.runs[0].frame[coordinate]);
    expect(positions[0]).toBeCloseTo(0);
    expect(positions[1]).toBeGreaterThan(positions[0]);
    expect(positions[2]).toBeCloseTo(positions[1] * 2);
    const blockCoordinate = direction === 'tbRl' ? 'x' : 'y';
    const block = ['start', 'middle', 'end'].map((directionAlign) => new PaginationEngine(book, {
      ...defaultSettings, direction, directionAlign: directionAlign as 'start' | 'middle' | 'end',
    }, 320, 370).pageAtPosition(0));
    const starts = block.map((page) => page.context.runs[0].frame[blockCoordinate]);
    expect(Math.abs(starts[2] - starts[0])).toBeGreaterThan(100);
    expect(starts[1]).toBeCloseTo((starts[0] + starts[2]) / 2);
    expect(block.every((page) => page.text === '短い文')).toBe(true);
  });

  it('uses the requested tight line spacing and independent Latin scale', () => {
    const book = fixture([{ text: 'あ' }, { text: 'いA' }]);
    const page = new PaginationEngine(book, { ...defaultSettings, direction, lineHeight: 1.8, latinFont: 'georgia', latinScale: 0.8 }, 320, 370).pageAtPosition(0);
    const first = page.context.runs.find((run) => run.char === 'あ')!;
    const next = page.context.runs.find((run) => run.char === 'い')!;
    expect(Math.abs(direction === 'tbRl' ? first.frame.x - next.frame.x : next.frame.y - first.frame.y)).toBeCloseTo(36);
    const latin = page.glyphs.find((glyph) => glyph.text === 'A')!;
    expect(latin.fontFamily).toBe('Georgia, serif');
    expect(latin.fontSize).toBeCloseTo(16);
    expect(page.glyphs.find((glyph) => glyph.text === 'あ')!.fontSize).toBe(20);
  });

  it('preserves all text across pages with nondefault typography', () => {
    const book = fixture([{ text: '「組版。」日本語 English 12月。𤄃か\u309a\n'.repeat(45), rubies: [{ start: 1, end: 3, reading: 'くみはん' }] }]);
    for (const directionAlign of ['start', 'middle', 'end'] as const) {
      const engine = new PaginationEngine(book, { ...defaultSettings, direction, directionAlign,
        fontSize: 29, lineHeight: 1.25, punctuationMode: 'half', textAlign: 'justify',
        dividesByWords: false, kinsoku: false, allowsTateChuYoko: false, latinScale: 1.12,
      }, 320, 370);
      let text = '';
      while (text.length < engine.index.text.length) {
        const page = engine.pageAtPosition(text.length);
        expect(page.globalEnd).toBeGreaterThan(page.globalStart);
        expect(page.context.runs.every((run) => Object.values(run.frame).every(Number.isFinite))).toBe(true);
        expect(page.context.runs.every((run) => run.visibility === 'visible')).toBe(true);
        text += page.text;
      }
      expect(text).toBe(engine.index.text);
    }
  });

  it('applies word wrapping and the vertical number toggle to actual glyph placement', () => {
    if (direction === 'tbRl') {
      const book = fixture([{ text: '12月' }]);
      const rotations = [false, true].map((allowsTateChuYoko) => new PaginationEngine(book, {
        ...defaultSettings, direction, allowsTateChuYoko,
      }, 320, 370).pageAtPosition(0).glyphs.find((glyph) => glyph.text === '1')!.rotate);
      expect(rotations).toEqual([90, 0]);
    } else {
      const book = fixture([{ text: '日本語 typography' }]);
      const wordLines = [false, true].map((dividesByWords) => new PaginationEngine(book, {
        ...defaultSettings, direction, dividesByWords,
      }, 156, 370).pageAtPosition(0).context.runs.filter((run) => /[a-z]/u.test(run.char)).map((run) => run.line));
      expect(new Set(wordLines[0]).size).toBeGreaterThan(1);
      expect(new Set(wordLines[1]).size).toBe(1);
    }
  });

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
