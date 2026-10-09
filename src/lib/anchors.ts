import type { Anchor, Book, TextBlock } from '../types';

type AnchorBook = Pick<Book, 'blocks' | 'contentVersion' | 'toc'>;
export interface RestoredAnchor {
  anchor: Anchor;
  adjusted: boolean;
  reason: 'exact' | 'context' | 'heading' | 'start';
}

// The context starts at the saved position so an insertion before it is reversible.
const CONTEXT_LENGTH = 40;

/** Clamp away from UTF-16 surrogate pairs and combining-mark boundaries. */
function safeOffset(text: string, offset: number): number {
  let result = Math.min(text.length, Math.max(0, Number.isFinite(offset) ? Math.floor(offset) : 0));
  if (result > 0 && result < text.length && /[\uDC00-\uDFFF]/.test(text[result]) && /[\uD800-\uDBFF]/.test(text[result - 1])) result -= 1;
  // Intl.Segmenter covers combining marks, variation selectors, emoji and ZWJ.
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: string }) =>
    { segment(input: string): Iterable<{ index: number }> } }).Segmenter;
  if (Segmenter && result < text.length) {
    for (const part of new Segmenter('ja', { granularity: 'grapheme' }).segment(text)) {
      if (part.index === result) return result;
      if (part.index > result) break;
      offset = part.index;
    }
    return Math.max(0, Math.min(result, offset));
  }
  return result;
}

function anchorFor(block: TextBlock | undefined, offset = 0): Anchor {
  if (!block) return { blockId: '', offset: 0, context: '' };
  const start = safeOffset(block.text, offset);
  const end = safeOffset(block.text, start + CONTEXT_LENGTH);
  return { blockId: block.id, offset: start, context: block.text.slice(start, end) };
}

export function createAnchor(book: AnchorBook, blockId: string, offset: number): Anchor {
  const block = book.blocks.find((candidate) => candidate.id === blockId);
  return block ? anchorFor(block, offset) : anchorFor(book.blocks[0]);
}

function nearestHeading(book: AnchorBook, blockIndex: number): TextBlock | undefined {
  const headingIds = new Set(book.toc.map((heading) => heading.blockId));
  for (let index = Math.min(blockIndex, book.blocks.length - 1); index >= 0; index -= 1) {
    const block = book.blocks[index];
    if (block.kind === 'heading' || headingIds.has(block.id)) return block;
  }
  return undefined;
}

export function restoreAnchor(book: AnchorBook, saved: Anchor, previousContentVersion: string): RestoredAnchor {
  const blockIndex = book.blocks.findIndex((block) => block.id === saved.blockId);
  const block = book.blocks[blockIndex];
  if (book.contentVersion === previousContentVersion && block) {
    const anchor = anchorFor(block, saved.offset);
    return { anchor, adjusted: anchor.offset !== saved.offset, reason: 'exact' };
  }

  // After an update, accept a context only when it identifies one position.
  // Duplicated prose must not silently attach a bookmark to another occurrence.
  if (saved.context) {
    const matches: { block: TextBlock; offset: number }[] = [];
    for (const candidate of book.blocks) {
      let position = candidate.text.indexOf(saved.context);
      while (position !== -1 && matches.length < 2) {
        matches.push({ block: candidate, offset: position });
        position = candidate.text.indexOf(saved.context, position + 1);
      }
      if (matches.length >= 2) break;
    }
    if (matches.length === 1) return { anchor: anchorFor(matches[0].block, matches[0].offset), adjusted: true, reason: 'context' };
  }

  const heading = blockIndex >= 0 ? nearestHeading(book, blockIndex) : undefined;
  return heading
    ? { anchor: anchorFor(heading), adjusted: true, reason: 'heading' }
    : { anchor: anchorFor(book.blocks[0]), adjusted: true, reason: 'start' };
}

export function anchorProgress(book: Pick<Book, 'blocks'>, anchor: Anchor): number {
  const total = book.blocks.reduce((sum, block) => sum + block.text.length, 0);
  if (!total) return 0;
  let before = 0;
  for (const block of book.blocks) {
    if (block.id === anchor.blockId) return Math.min(1, (before + safeOffset(block.text, anchor.offset)) / total);
    before += block.text.length;
  }
  return 0;
}
