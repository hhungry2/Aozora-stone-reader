import { isInseparablePair, isNotEndingChar, isNotStartingChar, Layouter, type Rect, type Run, type StoneContext } from '@non-standardworld/stone-engine.js';
import type { ReaderPageData, RubyPlacement } from './engine';

/** Geometry is in body coordinates, before the page's inset translation. */
export interface AnatomyRuby {
  key: string;
  reading: string;
  /** Parent characters allocated to this reading fragment on its displayed line. */
  parentText: string;
  sourceStart: number;
  sourceEnd: number;
  readingOffset: number;
  parentFrame: Rect;
  readingFrame: Rect;
  scaleX: number;
  scaleY: number;
  runIds: number[];
}

export interface AnatomyLineBreak {
  runId: number;
  nextRunId: number;
  line: number;
  sourceEnd: number;
  startFrame: Rect;
  endFrame: Rect;
  nextFrame: Rect;
  /** Source position where the same line would end without kinsoku. */
  withoutKinsokuEnd: number;
  reason: 'line-start' | 'line-end' | 'inseparable' | 'adjusted';
  forbiddenText: string;
  movedText: string;
}

export interface AnatomyGlyph {
  runId: number;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  frame: Rect;
  /** The measured horizontal glyph advance; this does not describe ink bounds. */
  measuredAdvance: number;
  /** The actual occupied length along this writing direction, after punctuation spacing. */
  inlineExtent: number;
  fontSize: number;
  emRatio: number;
  punctuation: boolean;
  punctuationCategory: Run['punctuation'];
  rubies: AnatomyRuby[];
  kinsokuBreak?: AnatomyLineBreak;
}

export interface PageAnatomy {
  glyphs: AnatomyGlyph[];
  rubies: AnatomyRuby[];
  kinsokuBreaks: AnatomyLineBreak[];
}

function bounds(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function readingBounds(ruby: RubyPlacement): Rect | null {
  if (!ruby.glyphs.length) return null;
  return bounds(ruby.glyphs.map(({ run }) => ({
    x: ruby.x + run.frame.x * ruby.scaleX,
    y: ruby.y + run.frame.y * ruby.scaleY,
    width: run.frame.width * ruby.scaleX,
    height: run.frame.height * ruby.scaleY,
  })));
}

function sourceOffsets(page: ReaderPageData): number[] {
  let offset = page.globalStart;
  const offsets = page.context.runs.map((run) => {
    const start = offset;
    offset += run.char.length;
    return start;
  });
  offsets.push(offset);
  return offsets;
}

function rubyAnatomy(page: ReaderPageData, offsets: number[]): AnatomyRuby[] {
  const output: AnatomyRuby[] = [];
  for (const range of page.ranges) for (const ruby of range.block.rubies) {
    const sourceStart = range.start + ruby.start;
    const sourceEnd = range.start + ruby.end;
    const parents = page.context.runs.flatMap((run, runId) =>
      offsets[runId] >= sourceStart && offsets[runId] < sourceEnd && !run.isNewline ? [{ run, runId }] : []);
    if (!parents.length) continue;
    const lines = [...new Set(parents.map(({ run }) => run.line))];
    const placements = page.rubies.filter((placement) => placement.sourceStart === sourceStart);
    // Each placement is produced for one parent line, in source order. Empty reading
    // allocations are omitted by the engine, so use its line-bearing identity key.
    for (const placement of placements) {
      const line = lines.find((value) => placement.key === `${sourceStart - page.globalStart}-${value}`);
      if (line === undefined) continue;
      const group = parents.filter(({ run }) => run.line === line);
      const readingFrame = readingBounds(placement);
      if (!readingFrame) continue;
      output.push({
        key: placement.key,
        reading: placement.reading,
        parentText: group.map(({ run }) => run.char).join(''),
        sourceStart, sourceEnd, readingOffset: placement.readingOffset,
        parentFrame: bounds(group.map(({ run }) => run.frame)),
        readingFrame,
        scaleX: placement.scaleX, scaleY: placement.scaleY,
        runIds: group.map(({ runId }) => runId),
      });
    }
  }
  return output;
}

/** Replay the same measured runs and token boundaries without mutating the page. */
function firstLineEnd(context: StoneContext, start: number, end: number, inline: number, kinsoku: boolean): number {
  const tokenIds = new Map<number, number>();
  const tokens = context.tokens.flatMap((token, id) => {
    if (token.end <= start || token.start >= end) return [];
    tokenIds.set(id, tokenIds.size);
    return [{ start: Math.max(start, token.start) - start, end: Math.min(end, token.end) - start }];
  });
  const runs = context.runs.slice(start, end).map((run, index) => {
    const tokenId = tokenIds.get(run.tokenId)!;
    return {
      ...run,
      tokenId,
      tokenRunIndex: index - tokens[tokenId].start,
      position: { ...run.position }, frame: { ...run.frame },
    };
  });
  // FontManager retains the exact fonts, style variants and original measurer.
  // Layouter only reads these; every object it changes is cloned above/below.
  const replay: StoneContext = Object.assign(Object.create(Object.getPrototypeOf(context)), context, {
    runs, tokens, kinsoku,
    renderSize: context.direction === 'tbRl'
      ? { width: Infinity, height: inline }
      : { width: inline, height: Infinity },
    renderedSize: { width: 0, height: 0 },
  });
  new Layouter(replay).layout();
  return start + (replay.lineRanges()[0]?.end ?? 0);
}

function changedLineBreaks(page: ReaderPageData, offsets: number[]): AnatomyLineBreak[] {
  const context = page.context;
  if (!context.kinsoku) return [];
  const vertical = context.direction === 'tbRl';
  const available = vertical ? context.renderSize.height : context.renderSize.width;
  const changes: AnatomyLineBreak[] = [];
  for (const range of page.ranges) {
    const start = offsets.findIndex((offset, index) => index < context.runs.length && offset >= Math.max(page.globalStart, range.start));
    if (start < 0 || offsets[start] > range.end) continue;
    let end = offsets.findIndex((offset) => offset > range.end);
    if (end < 0) end = context.runs.length;
    const existingIndent = range.block.text.match(/^　*/u)?.[0].length ?? 0;
    const requestedIndent = Math.max(0, range.block.indent - existingIndent) * context.fontSize;
    const indent = Math.min(requestedIndent, Math.max(0, available - context.fontSize * 2));
    const inline = available - indent;
    let lineStart = start;
    while (lineStart < end) {
      let actualEnd = lineStart + 1;
      while (actualEnd < end && context.runs[actualEnd].line === context.runs[lineStart].line) actualEnd += 1;
      // A page edge has no following run. Explicit newlines and block boundaries
      // are author input; they must never be shown as a kinsoku adjustment.
      if (actualEnd < end && !context.runs[actualEnd - 1].isNewline) {
        const plainEnd = firstLineEnd(context, lineStart, end, inline, false);
        if (actualEnd < plainEnd && firstLineEnd(context, lineStart, end, inline, true) === actualEnd) {
          const plainLast = context.runs[plainEnd - 1];
          const plainNext = context.runs[plainEnd];
          const reason = isNotEndingChar(plainLast.char) ? 'line-end'
            : plainNext && isNotStartingChar(plainNext.char) ? 'line-start'
              : plainNext && isInseparablePair(plainLast.char, plainNext.char) ? 'inseparable' : 'adjusted';
          changes.push({
            runId: actualEnd - 1, nextRunId: actualEnd, line: context.runs[lineStart].line,
            sourceEnd: offsets[actualEnd],
            startFrame: { ...context.runs[lineStart].frame },
            endFrame: { ...context.runs[actualEnd - 1].frame },
            nextFrame: { ...context.runs[actualEnd].frame },
            withoutKinsokuEnd: offsets[plainEnd], reason,
            forbiddenText: reason === 'line-start' ? plainNext.char
              : reason === 'inseparable' ? plainLast.char + plainNext.char : plainLast.char,
            movedText: context.runs.slice(actualEnd, plainEnd).map((run) => run.char).join(''),
          });
        }
      }
      lineStart = actualEnd;
    }
  }
  return changes;
}

export function createAnatomy(page: ReaderPageData): PageAnatomy {
  const offsets = sourceOffsets(page);
  const rubies = rubyAnatomy(page, offsets);
  const kinsokuBreaks = changedLineBreaks(page, offsets);
  const vertical = page.context.direction === 'tbRl';
  const glyphs = page.context.runs.flatMap((run, runId): AnatomyGlyph[] => {
    if (run.isNewline || run.char === '\ufffc') return [];
    const fontSize = page.context.fontManager.scaledSize(run.fontId, page.context.adjustFontSize);
    const inlineExtent = vertical ? run.frame.height : run.frame.width;
    return [{
      runId, text: run.char, sourceStart: offsets[runId], sourceEnd: offsets[runId + 1],
      frame: { ...run.frame }, measuredAdvance: run.advance, inlineExtent,
      fontSize, emRatio: fontSize > 0 ? inlineExtent / fontSize : 0,
      punctuation: run.punctuation !== 'whole' || /^\p{P}/u.test(run.char),
      punctuationCategory: run.punctuation,
      rubies: rubies.filter((ruby) => ruby.runIds.includes(runId)),
      kinsokuBreak: kinsokuBreaks.find((lineBreak) => lineBreak.line === run.line),
    }];
  });
  return { glyphs, rubies, kinsokuBreaks };
}

export function inspectAnatomyRun(page: ReaderPageData, runId: number, anatomy = createAnatomy(page)): AnatomyGlyph | null {
  return anatomy.glyphs.find((glyph) => glyph.runId === runId) ?? null;
}
