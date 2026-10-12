import { describe, expect, it } from 'vitest';
import { FixedMeasurer } from '@non-standardworld/stone-engine.js';
import { createAnatomy, inspectAnatomyRun } from '../src/reader/anatomy';
import { indexBook, PaginationEngine } from '../src/reader/engine';
import { defaultSettings, type Book, type ReaderSettings, type TextBlock } from '../src/types';

function fixture(blocks: Partial<TextBlock>[]): Book {
  return {
    id: 'anatomy', title: '', titleKana: '', subtitle: '', authors: [], authorLabel: '',
    cardUrl: '', dataPath: '', contentVersion: '1', characterCount: 0, excerpt: '', features: [],
    schemaVersion: 1, blocks: blocks.map((block, index) => ({
      id: `p${index}`, kind: 'paragraph', text: '', rubies: [], emphasis: [], inlineImages: [], indent: 0, ...block,
    })), toc: [], credits: '', source: { url: '', fetchedAt: '', sha256: '', encoding: 'UTF-8' },
    conversion: { version: '', warnings: [] },
  };
}

function layout(book: Book, direction: ReaderSettings['direction'], settings: Partial<ReaderSettings> = {}) {
  return new PaginationEngine(book, {
    ...defaultSettings, direction, dividesByWords: false, punctuationMode: 'whole', ...settings,
  }, direction === 'lrTb' ? 122 : 420, direction === 'tbRl' ? 122 : 420, new FixedMeasurer());
}

it('compares kinsoku with the original custom measurements and font style variants', () => {
  class WideMeasurer extends FixedMeasurer {
    override advance(...args: Parameters<FixedMeasurer['advance']>) {
      return super.advance(...args) * 1.5;
    }
  }
  const page = new PaginationEngine(fixture([{ kind: 'heading', text: '甲乙丙。丁戊己庚' }]), {
    ...defaultSettings, direction: 'lrTb', dividesByWords: false, punctuationMode: 'whole',
  }, 122, 420, new WideMeasurer()).pageAtPosition(0);
  const fontsBefore = structuredClone(page.context.fonts);
  const anatomy = createAnatomy(page);
  expect(anatomy.kinsokuBreaks[0]).toMatchObject({ sourceEnd: 2, withoutKinsokuEnd: 3, reason: 'line-start' });
  expect(anatomy.glyphs[0].measuredAdvance).toBe(30);
  expect(page.context.fontManager.font(page.context.runs[0].fontId).weight).toBe(700);
  expect(page.context.fonts).toEqual(fontsBefore);
});

for (const direction of ['lrTb', 'tbRl'] as const) describe(`anatomy ${direction}`, () => {
  it('distinguishes a punctuation frame from measured glyph advance', () => {
    const page = layout(fixture([{ text: '甲、乙「丙」' }]), direction, { punctuationMode: 'half' }).pageAtPosition(0);
    const punctuation = createAnatomy(page).glyphs.find((glyph) => glyph.text === '、')!;
    expect(punctuation.punctuation).toBe(true);
    expect(punctuation.punctuationCategory).toBe('firstHalf');
    expect(punctuation.measuredAdvance).toBe(20);
    expect(punctuation.inlineExtent).toBe(10);
    expect(punctuation.fontSize).toBe(20);
    expect(punctuation.emRatio).toBe(0.5);
    expect(punctuation.frame).toEqual(page.context.runs[punctuation.runId].frame);
    const whole = createAnatomy(layout(fixture([{ text: '甲、乙' }]), direction).pageAtPosition(0));
    expect(whole.glyphs.find((glyph) => glyph.text === '、')?.emRatio).toBe(1);
  });

  it.each([
    ['甲乙丙丁戊。己庚辛壬', 'line-start', '。'],
    ['甲乙丙丁「戊己庚辛壬', 'line-end', '「'],
    ['甲乙丙丁……戊己庚辛', 'inseparable', '……'],
  ] as const)('marks the observed break caused by kinsoku in %s', (text, reason, forbiddenText) => {
    const page = layout(fixture([{ text }]), direction).pageAtPosition(0);
    const anatomy = createAnatomy(page);
    const boundary = anatomy.kinsokuBreaks[0];
    expect(boundary).toMatchObject({ sourceEnd: 4, withoutKinsokuEnd: 5, reason, forbiddenText, runId: 3, nextRunId: 4 });
    expect(boundary.movedText).toBe(text[4]);
    expect(boundary.endFrame).toEqual(page.context.runs[3].frame);
    expect(boundary.nextFrame).toEqual(page.context.runs[4].frame);
    expect(inspectAnatomyRun(page, 3, anatomy)?.kinsokuBreak).toBe(boundary);
    expect(createAnatomy(layout(fixture([{ text }]), direction, { kinsoku: false }).pageAtPosition(0)).kinsokuBreaks).toEqual([]);
  });

  it('does not label ordinary wraps, explicit newlines or page edges as kinsoku', () => {
    const page = layout(fixture([{ text: '甲乙丙丁戊己庚辛壬癸\n甲乙丙丁\n' }]), direction).pageAtPosition(0);
    expect(createAnatomy(page).kinsokuBreaks).toEqual([]);
    const longPage = layout(fixture([{ text: '甲乙丙丁戊己庚辛壬癸'.repeat(120) }]), direction).pageAtPosition(0);
    expect(longPage.globalEnd).toBeLessThan(1200);
    expect(createAnatomy(longPage).kinsokuBreaks).toEqual([]);
  });

  it('replays each block with its original indentation and leaves page state intact', () => {
    const book = fixture([
      { text: '甲乙丙丁戊。己庚辛壬' },
      { text: '甲乙丙戊。己庚辛壬癸', indent: 1 },
    ]);
    const page = layout(book, direction).pageAtPosition(0);
    const beforeRuns = structuredClone(page.context.runs);
    const beforeTokens = structuredClone(page.context.tokens);
    const beforeRenderSize = { ...page.context.renderSize };
    const anatomy = createAnatomy(page);
    expect(anatomy.kinsokuBreaks.map((boundary) => boundary.sourceEnd)).toEqual([4, book.blocks[0].text.length + 1 + 3]);
    expect(page.context.runs).toEqual(beforeRuns);
    expect(page.context.tokens).toEqual(beforeTokens);
    expect(page.context.renderSize).toEqual(beforeRenderSize);
  });

  it('uses source UTF-16 positions for supplementary and combining graphemes after a nonzero anchor', () => {
    const book = fixture([{ text: '先行𠮷' }, { text: '𠮷か\u3099甲乙' }]);
    const page = layout(book, direction).pageAt({ blockId: 'p1', offset: 0, context: '' });
    const start = indexBook(book).ranges[1].start;
    const anatomy = createAnatomy(page);
    expect(anatomy.glyphs.slice(0, 3).map((glyph) => [glyph.text, glyph.sourceStart, glyph.sourceEnd])).toEqual([
      ['𠮷', start, start + 2], ['か\u3099', start + 2, start + 4], ['甲', start + 4, start + 5],
    ]);
    expect(inspectAnatomyRun(page, -1, anatomy)).toBeNull();
  });

  it('reports the transformed ruby allocation for each actual parent line', () => {
    const parentText = '甲乙丙丁戊己庚辛壬癸';
    const reading = 'こうおつへいていぼきこうしんじんき'.repeat(3);
    const page = layout(fixture([{ text: parentText, rubies: [{ start: 0, end: parentText.length, reading }] }]), direction).pageAtPosition(0);
    const anatomy = createAnatomy(page);
    expect(anatomy.rubies.length).toBe(2);
    expect(anatomy.rubies.map((ruby) => ruby.reading).join('')).toBe(reading);
    expect(anatomy.rubies.map((ruby) => ruby.parentText).join('')).toBe(parentText);
    anatomy.rubies.forEach((ruby, index) => {
      const placement = page.rubies[index];
      expect(ruby).toMatchObject({ parentText: parentText.slice(index * 5, (index + 1) * 5), sourceStart: 0, sourceEnd: parentText.length });
      expect(ruby.runIds).toHaveLength(5);
      expect(direction === 'tbRl' ? ruby.scaleY : ruby.scaleX).toBeLessThan(1);
      expect(ruby.readingFrame.width).toBeGreaterThan(0);
      expect(ruby.readingFrame.height).toBeGreaterThan(0);
      expect(direction === 'tbRl' ? ruby.parentFrame.height : ruby.parentFrame.width).toBe(100);
      const firstGlyph = placement.glyphs[0];
      expect(ruby.readingFrame.x).toBeLessThanOrEqual(placement.x + firstGlyph.run.frame.x * placement.scaleX);
      expect(ruby.readingFrame.y).toBeLessThanOrEqual(placement.y + firstGlyph.run.frame.y * placement.scaleY);
      expect(inspectAnatomyRun(page, ruby.runIds[0], anatomy)?.rubies).toContain(ruby);
    });
  });
});
