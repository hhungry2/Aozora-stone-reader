import type { Anchor, Book, TextBlock } from "../types";

const Segmenter = (
  Intl as unknown as {
    Segmenter?: new (
      locale: string,
      options: { granularity: string },
    ) => {
      segment: (text: string) => Iterable<{
        index: number;
        segment: string;
      }> & {
        containing: (
          offset: number,
        ) => { index: number; segment: string } | undefined;
      };
    };
  }
).Segmenter;
const segmenter = Segmenter
  ? new Segmenter("ja", { granularity: "grapheme" })
  : null;

export interface SpeechSource {
  blocks: TextBlock[];
  byId: Map<string, number>;
  starts: number[];
}

export interface SpeechChunk {
  text: string;
  excerpt: string;
  start: Anchor;
  next: Anchor;
  position: number;
}

/** Keep the speech source independent of the rendering engine and its page cache. */
export function createSpeechSource(book: Pick<Book, "blocks">): SpeechSource {
  let position = 0;
  const starts = book.blocks.map((block) => {
    const start = position;
    position +=
      (block.kind === "image" && !block.text ? 1 : block.text.length) + 1;
    return start;
  });
  return {
    blocks: book.blocks,
    byId: new Map(book.blocks.map((block, index) => [block.id, index])),
    starts,
  };
}

function anchor(block: TextBlock, offset: number): Anchor {
  return {
    blockId: block.id,
    offset,
    context: block.text.slice(offset, offset + 40),
  };
}

function safeOffset(text: string, offset: number) {
  let result = Math.max(
    0,
    Math.min(text.length, Number.isFinite(offset) ? Math.floor(offset) : 0),
  );
  if (segmenter && result < text.length)
    return segmenter.segment(text).containing(result)?.index ?? result;
  // Do not begin/end in the middle of a supplementary character or combining mark.
  while (
    result > 0 &&
    result < text.length &&
    /[\uDC00-\uDFFF\p{Mark}\u200d]/u.test(text[result])
  )
    result--;
  return result;
}

/** Generate just the next short sentence, rather than queueing an entire novel. */
export function nextSpeechChunk(
  source: SpeechSource,
  from: Anchor,
): SpeechChunk | null {
  let index = source.byId.get(from.blockId) ?? 0;
  let offset = from.offset;
  while (index < source.blocks.length) {
    const block = source.blocks[index];
    if (block.kind === "image") {
      if (offset === 0 && block.image?.alt.trim()) {
        return {
          text: block.image.alt.trim(),
          excerpt: block.image.alt,
          start: anchor(block, 0),
          next: source.blocks[index + 1]
            ? anchor(source.blocks[index + 1], 0)
            : anchor(block, Math.max(1, block.text.length)),
          position: source.starts[index],
        };
      }
      index++;
      offset = 0;
      continue;
    }
    let start = safeOffset(block.text, offset);
    // A page may start halfway through a ruby. Speak that word's full reading once.
    const ranges = [...block.rubies, ...block.inlineImages].sort(
      (a, b) => a.start - b.start,
    );
    const containing = ranges.find(
      (range) => range.start < start && range.end > start,
    );
    if (containing) start = containing.start;
    let end = safeOffset(block.text, start + 120);
    // A single combining/emoji sequence may itself exceed the normal chunk limit.
    if (end === start && start < block.text.length) {
      end =
        start +
        (segmenter?.segment(block.text).containing(start)?.segment.length ??
          (block.text.codePointAt(start)! > 0xffff ? 2 : 1));
    }
    const sentence = /[。！？!?\n]+[」』）】”’]*/u.exec(
      block.text.slice(start, end),
    );
    if (sentence) end = start + sentence.index + sentence[0].length;
    // Retain the complete source range when a boundary falls inside ruby or gaiji.
    for (const range of ranges) {
      if (range.start < end && range.end > end) end = range.end;
    }
    end = Math.min(block.text.length, end);
    let text = "";
    let at = start;
    for (const range of ranges) {
      if (range.start < at || range.end > end) continue;
      text += block.text.slice(at, range.start);
      text += "reading" in range ? range.reading : range.alt;
      at = range.end;
    }
    text += block.text.slice(at, end);
    text = text.replace(/\ufffc/gu, "").trim();
    const next =
      end < block.text.length || !source.blocks[index + 1]
        ? anchor(block, end)
        : anchor(source.blocks[index + 1], 0);
    if (text) {
      return {
        text,
        excerpt: block.text.slice(start, end).replace(/\ufffc/gu, ""),
        start: anchor(block, start),
        next,
        position: source.starts[index] + start,
      };
    }
    if (end < block.text.length) {
      offset = end;
    } else {
      index++;
      offset = 0;
    }
  }
  return null;
}
