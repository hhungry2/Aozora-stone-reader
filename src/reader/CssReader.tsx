import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  fontFamilies,
  latinFontFamilies,
  type Anchor,
  type Book,
  type ReaderSettings,
  type TextBlock,
} from "../types";
import { displayTitle } from "../lib/titles";
import { createAnchor } from "../lib/anchors";
import { readerImageUrl } from "../lib/assets";
import { loadReaderFont } from "./fonts";
import type { SpeechRange } from "./speech";
import "./css-reader.css";

export interface CssReaderPage {
  start: Anchor;
  end: Anchor;
  globalStart: number;
  globalEnd: number;
  text: string;
}

export interface CssReaderLocation {
  page: CssReaderPage | null;
  hasNext: boolean;
  hasPrevious: boolean;
  progress: number;
  isEnd: boolean;
  loading: boolean;
  error: string | null;
}

export interface CssReaderHandle {
  advance: (forward: boolean) => void;
  retry: () => void;
}

interface CssReaderProps {
  book: Book;
  settings: ReaderSettings;
  width: number;
  height: number;
  anchor: Anchor;
  onLocationChange: (location: CssReaderLocation) => void;
  speechRange?: SpeechRange | null;
}

interface SourceBlock {
  block: TextBlock;
  text: string;
  start: number;
  end: number;
  graphemes?: {
    containing: (
      offset: number,
    ) => { index: number; segment: string } | undefined;
  };
}

interface SourceRun {
  start: number;
  end: number;
  element: HTMLElement;
  node: Text | null;
}

interface MeasuredBlock extends SourceBlock {
  element: HTMLElement;
  runs: SourceRun[];
}

const anchorKey = (anchor: Anchor) => `${anchor.blockId}:${anchor.offset}`;
const sourceText = (block: TextBlock) =>
  block.kind === "image" && !block.text ? "\ufffc" : block.text;
const NativeSegmenter = (
  Intl as unknown as {
    Segmenter?: new (
      locale: string,
      options: { granularity: string },
    ) => {
      segment: (text: string) => NonNullable<SourceBlock["graphemes"]>;
    };
  }
).Segmenter;
const segmenter = NativeSegmenter
  ? new NativeSegmenter("ja", { granularity: "grapheme" })
  : null;

/** This source index deliberately has no dependency on either Stone module. */
function nativeIndex(book: Book) {
  let position = 0;
  const blocks = book.blocks.map((block, index) => {
    const text = sourceText(block);
    const start = position;
    position += text.length;
    const entry = { block, text, start, end: position };
    if (index + 1 < book.blocks.length) position += 1;
    return entry;
  });
  return {
    blocks,
    text: blocks.map((block) => block.text).join("\n"),
    byId: new Map(blocks.map((block, index) => [block.block.id, index])),
  };
}

function graphemeRange(block: SourceBlock, offset: number) {
  const at = Math.max(0, Math.min(block.text.length, offset));
  if (at === block.text.length) return { start: at, end: at };
  if (segmenter) {
    block.graphemes ??= segmenter.segment(block.text);
    const segment = block.graphemes.containing(at);
    if (segment)
      return {
        start: segment.index,
        end: segment.index + segment.segment.length,
      };
  }
  let start = at;
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(block.text[start])) start -= 1;
  const length = (block.text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1;
  return { start, end: start + length };
}

function sourceAnchor(
  book: Book,
  block: SourceBlock | undefined,
  offset: number,
  trailing = false,
): Anchor {
  if (!block) return { blockId: "", offset: 0, context: "" };
  const edge = graphemeRange(block, offset);
  const at = trailing && offset > edge.start ? edge.end : edge.start;
  // Source image placeholders occupy one position even when their source text is empty.
  if (block.block.kind === "image" && !block.block.text)
    return {
      blockId: block.block.id,
      offset: at,
      context: block.text.slice(at, at + 40),
    };
  return createAnchor(book, block.block.id, at);
}

/** Group text at annotation/run boundaries, rather than creating a DOM node per character. */
function blockContent(
  block: TextBlock,
  settings: ReaderSettings,
  speechRange?: SpeechRange | null,
): ReactNode[] {
  const text = block.text;
  const images = [...block.inlineImages].sort((a, b) => a.start - b.start);
  const rubies = settings.ruby
    ? [...block.rubies].sort((a, b) => a.start - b.start)
    : [];
  const plain = (
    start: number,
    end: number,
    speakingRuby = false,
  ): ReactNode[] => {
    const boundaries = new Set([start, end]);
    // Keep source runs intact outside the current sentence, including long paragraphs.
    if (speechRange) {
      if (speechRange.start > start && speechRange.start < end)
        boundaries.add(speechRange.start);
      if (speechRange.end > start && speechRange.end < end)
        boundaries.add(speechRange.end);
    }
    for (const emphasis of block.emphasis) {
      if (emphasis.start > start && emphasis.start < end)
        boundaries.add(emphasis.start);
      if (emphasis.end > start && emphasis.end < end)
        boundaries.add(emphasis.end);
    }
    for (const image of images) {
      if (image.start >= start && image.end <= end) {
        boundaries.add(image.start);
        boundaries.add(image.end);
      }
    }
    // Latin text and short numeral runs use native inline formatting, including text-combine-upright.
    for (const match of text
      .slice(start, end)
      .matchAll(
        /[0-9０-９]+|[A-Za-z\u00c0-\u024f]+(?:[ '-][A-Za-z\u00c0-\u024f]+)*/gu,
      )) {
      boundaries.add(start + match.index);
      boundaries.add(start + match.index + match[0].length);
    }
    const cuts = [...boundaries].sort((a, b) => a - b);
    const pieces: ReactNode[] = [];
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const from = cuts[index];
      const to = cuts[index + 1];
      const speaking =
        !speakingRuby &&
        !!speechRange &&
        from >= speechRange.start &&
        to <= speechRange.end;
      const image = images.find(
        (entry) =>
          entry.start <= from &&
          entry.end > from &&
          entry.start >= start &&
          entry.end <= end,
      );
      if (image) {
        if (image.start === from)
          pieces.push(
            <span
              key={`image-${from}`}
              className={`css-reader-inline-image${speaking ? " reader-speech-active" : ""}`}
              data-css-run
              data-css-start={from}
              data-css-end={image.end}
            >
              <img
                src={readerImageUrl(image.src)}
                alt={image.alt}
                draggable={false}
              />
            </span>,
          );
        continue;
      }
      const value = text.slice(from, to);
      const emphasis = block.emphasis.find(
        (entry) => entry.start <= from && entry.end >= to,
      );
      const latin = /^[A-Za-z\u00c0-\u024f]/u.test(value);
      const tcy =
        settings.allowsTateChuYoko && /^[0-9０-９]{1,2}$/u.test(value);
      const classes = [
        emphasis && "css-reader-emphasis",
        latin && "css-reader-latin",
        tcy && "css-reader-tcy",
        speaking && "reader-speech-active",
      ]
        .filter(Boolean)
        .join(" ");
      pieces.push(
        <span
          key={`text-${from}`}
          className={classes || undefined}
          data-css-run
          data-css-start={from}
          data-css-end={to}
        >
          {value}
        </span>,
      );
    }
    return pieces;
  };
  const result: ReactNode[] = [];
  let offset = 0;
  for (const ruby of rubies) {
    if (ruby.start < offset || ruby.end > text.length || ruby.end <= ruby.start)
      continue;
    result.push(...plain(offset, ruby.start));
    const speaking =
      !!speechRange &&
      ruby.start >= speechRange.start &&
      ruby.end <= speechRange.end;
    result.push(
      <ruby
        key={`ruby-${ruby.start}`}
        className={speaking ? "reader-speech-active" : undefined}
      >
        {plain(ruby.start, ruby.end, speaking)}
        <rt>{ruby.reading}</rt>
      </ruby>,
    );
    offset = ruby.end;
  }
  result.push(...plain(offset, text.length));
  return result;
}

function openingContent(text: string, settings: ReaderSettings): ReactNode[] {
  return text
    .split(
      /([0-9０-９]+|[A-Za-z\u00c0-\u024f]+(?:[ '-][A-Za-z\u00c0-\u024f]+)*)/u,
    )
    .map((part, index) => {
      const className =
        settings.allowsTateChuYoko && /^[0-9０-９]{1,2}$/u.test(part)
          ? "css-reader-tcy"
          : /^[A-Za-z\u00c0-\u024f]/u.test(part)
            ? "css-reader-latin"
            : undefined;
      return className ? (
        <span key={index} className={className}>
          {part}
        </span>
      ) : (
        part
      );
    });
}

const NativeBlock = memo(function NativeBlock({
  block,
  settings,
  speechRange,
}: {
  block: TextBlock;
  settings: ReaderSettings;
  speechRange?: SpeechRange | null;
}) {
  const attributes = {
    "data-css-block": block.id,
    style: { paddingInlineStart: `${Math.max(0, block.indent)}em` },
  };
  if (block.kind === "image" && block.image) {
    const image = (
      <img
        src={readerImageUrl(block.image.src)}
        alt={block.image.alt}
        draggable={false}
      />
    );
    return (
      <figure {...attributes} className="css-reader-image-block">
        {block.text ? (
          image
        ) : (
          <span data-css-run data-css-start={0} data-css-end={1}>
            {image}
          </span>
        )}
        {block.text && (
          <figcaption>{blockContent(block, settings, speechRange)}</figcaption>
        )}
      </figure>
    );
  }
  const content = blockContent(block, settings, speechRange);
  if (block.kind === "heading") {
    const Heading = `h${Math.max(1, Math.min(6, block.level ?? 2))}` as
      "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    return (
      <Heading {...attributes} className="css-reader-heading">
        {content}
      </Heading>
    );
  }
  return (
    <p
      {...attributes}
      className={block.kind === "note" ? "css-reader-note" : undefined}
    >
      {content.length ? content : <br />}
    </p>
  );
});

function textPosition(block: MeasuredBlock, requested: number): DOMRect {
  const edge = graphemeRange(
    block,
    Math.min(requested, Math.max(0, block.text.length - 1)),
  );
  const offset = edge.start;
  let low = 0;
  let high = block.runs.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (block.runs[middle].end <= offset) low = middle + 1;
    else high = middle;
  }
  const run = block.runs[low] ?? block.runs.at(-1);
  if (!run) return block.element.getBoundingClientRect();
  if (!run.node) return run.element.getBoundingClientRect();
  let local = Math.max(0, Math.min(run.node.length, offset - run.start));
  if (local === run.node.length && local > 0) local -= 1;
  if (local > 0 && /[\uDC00-\uDFFF]/u.test(run.node.data[local])) local -= 1;
  const length = Math.max(1, edge.end - edge.start);
  const range = document.createRange();
  range.setStart(run.node, local);
  range.setEnd(run.node, Math.min(run.node.length, local + length));
  return range.getBoundingClientRect();
}

/** Native HTML flow and Range geometry are the only layout/positioning mechanisms here. */
export const CssReader = forwardRef<CssReaderHandle, CssReaderProps>(
  function CssReader(
    { book, settings, width, height, anchor, onLocationChange, speechRange },
    ref,
  ) {
    const root = useRef<HTMLDivElement>(null);
    const documentElement = useRef<HTMLDivElement>(null);
    const source = useMemo(() => nativeIndex(book), [book]);
    const measured = useRef<MeasuredBlock[]>([]);
    const callback = useRef(onLocationChange);
    callback.current = onLocationChange;
    const requestedAnchor = useRef(anchor);
    requestedAnchor.current = anchor;
    const visibleAnchor = useRef(anchor);
    const lastEmittedAnchor = useRef("");
    const lastLocation = useRef("");
    const task = useRef<number | null>(null);
    const restorePending = useRef(false);
    const actions = useRef({
      advance: (_forward: boolean) => {},
      retry: () => {},
    });
    const [fontRevision, setFontRevision] = useState(0);
    const vertical = settings.direction === "tbRl";
    const ready = width >= 80 && height >= 80;
    const content = useMemo(
      () =>
        book.blocks.map((block) => (
          <NativeBlock
            key={block.id}
            block={block}
            settings={settings}
            speechRange={speechRange?.blockId === block.id ? speechRange : null}
          />
        )),
      [book, settings.ruby, settings.allowsTateChuYoko, speechRange],
    );
    const emit = (location: CssReaderLocation) => {
      const signature = JSON.stringify([
        book.id,
        book.contentVersion,
        location.page?.globalStart,
        location.page?.globalEnd,
        location.hasNext,
        location.hasPrevious,
        location.progress,
        location.loading,
        location.error,
      ]);
      if (signature === lastLocation.current) return;
      lastLocation.current = signature;
      if (location.page) {
        visibleAnchor.current = location.page.start;
        lastEmittedAnchor.current = anchorKey(location.page.start);
      }
      callback.current(location);
    };

    useImperativeHandle(
      ref,
      () => ({
        advance: (forward) => actions.current.advance(forward),
        retry: () => actions.current.retry(),
      }),
      [],
    );

    useEffect(() => {
      let active = true;
      const sample = `${book.title}${book.blocks
        .slice(0, 8)
        .map((block) => block.text)
        .join("")}`.slice(0, 500);
      void loadReaderFont(settings.font, sample).then(() => {
        if (active) setFontRevision((revision) => revision + 1);
      });
      const update = () => {
        if (active) setFontRevision((revision) => revision + 1);
      };
      document.fonts?.addEventListener("loadingdone", update);
      return () => {
        active = false;
        document.fonts?.removeEventListener("loadingdone", update);
      };
    }, [book, settings.font]);

    useLayoutEffect(() => {
      if (!ready || !root.current || !documentElement.current) {
        emit({
          page: null,
          hasNext: false,
          hasPrevious: false,
          progress: 0,
          isEnd: false,
          loading: true,
          error: null,
        });
        return;
      }
      const viewport = root.current;
      const elements = new Map(
        [
          ...documentElement.current.querySelectorAll<HTMLElement>(
            "[data-css-block]",
          ),
        ].map((element) => [element.dataset.cssBlock, element]),
      );
      measured.current = source.blocks.flatMap((block) => {
        const element = elements.get(block.block.id);
        if (!element) return [];
        const runs = [
          ...element.querySelectorAll<HTMLElement>("[data-css-run]"),
        ].map((run) => ({
          start: Number(run.dataset.cssStart),
          end: Number(run.dataset.cssEnd),
          element: run,
          node:
            run.firstChild?.nodeType === Node.TEXT_NODE
              ? (run.firstChild as Text)
              : null,
        }));
        return [{ ...block, element, runs }];
      });

      const measure = () => {
        if (!viewport.isConnected) return;
        try {
          const bounds = viewport.getBoundingClientRect();
          const extent = vertical
            ? viewport.clientWidth
            : viewport.clientHeight;
          const project = (rect: DOMRect) =>
            vertical
              ? {
                  start: bounds.right - rect.right,
                  end: bounds.right - rect.left,
                }
              : { start: rect.top - bounds.top, end: rect.bottom - bounds.top };
          const blocks = measured.current;
          let low = 0;
          let high = blocks.length;
          while (low < high) {
            const middle = (low + high) >>> 1;
            if (
              project(blocks[middle].element.getBoundingClientRect()).end <= 0.5
            )
              low = middle + 1;
            else high = middle;
          }
          const firstIndex = Math.min(low, Math.max(0, blocks.length - 1));
          low = firstIndex;
          high = blocks.length;
          while (low < high) {
            const middle = (low + high) >>> 1;
            if (
              project(blocks[middle].element.getBoundingClientRect()).start <
              extent - 0.5
            )
              low = middle + 1;
            else high = middle;
          }
          const lastIndex = Math.max(firstIndex, low - 1);
          const first = blocks[firstIndex];
          const last = blocks[lastIndex];
          const boundary = (
            block: MeasuredBlock | undefined,
            trailing: boolean,
          ) => {
            if (!block) return 0;
            let from = 0;
            let to = block.text.length;
            while (from < to) {
              const middle = (from + to) >>> 1;
              const rect = project(textPosition(block, middle));
              const before = trailing
                ? rect.start < extent - 0.5
                : rect.end <= 0.5;
              if (before) from = middle + 1;
              else to = middle;
            }
            // Keep UTF-16 anchors outside the middle of a surrogate pair.
            if (
              from > 0 &&
              from < block.text.length &&
              /[\uDC00-\uDFFF]/u.test(block.text[from])
            )
              from += trailing ? 1 : -1;
            return Math.max(0, Math.min(block.text.length, from));
          };
          const start = sourceAnchor(book, first, boundary(first, false));
          const end = sourceAnchor(book, last, boundary(last, true), true);
          const globalStart = (first?.start ?? 0) + start.offset;
          const globalEnd = Math.max(
            globalStart,
            (last?.start ?? 0) + end.offset,
          );
          const scroll = Math.max(
            0,
            vertical ? -viewport.scrollLeft : viewport.scrollTop,
          );
          const maximum = Math.max(
            0,
            (vertical ? viewport.scrollWidth : viewport.scrollHeight) - extent,
          );
          const hasNext = scroll < maximum - 1;
          emit({
            page: {
              start,
              end,
              globalStart,
              globalEnd,
              text: source.text.slice(globalStart, globalEnd),
            },
            hasNext,
            hasPrevious: scroll > 1,
            progress: hasNext
              ? source.text.length
                ? globalStart / source.text.length
                : 0
              : 1,
            isEnd: !hasNext,
            loading: false,
            error: null,
          });
        } catch (error) {
          emit({
            page: null,
            hasNext: false,
            hasPrevious: false,
            progress: 0,
            isEnd: false,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "ブラウザーの文字配置を取得できませんでした。",
          });
        }
      };

      const restore = () => {
        const target = visibleAnchor.current;
        const block = measured.current[source.byId.get(target.blockId) ?? 0];
        if (!block || (!block.start && !target.offset)) {
          viewport.scrollLeft = 0;
          viewport.scrollTop = 0;
          return;
        }
        const rect = textPosition(block, target.offset);
        const bounds = viewport.getBoundingClientRect();
        if (vertical) viewport.scrollLeft -= bounds.right - rect.right - 20;
        else viewport.scrollTop += rect.top - bounds.top - 20;
      };
      const schedule = (restoreAnchor = false) => {
        restorePending.current ||= restoreAnchor;
        if (task.current !== null) return;
        task.current = requestAnimationFrame(() => {
          task.current = null;
          if (restorePending.current) {
            restorePending.current = false;
            restore();
          }
          measure();
        });
      };
      actions.current = {
        advance: (forward) => {
          const extent = vertical
            ? viewport.clientWidth
            : viewport.clientHeight;
          // Overlap one native line/column so glyphs clipped at a screen edge
          // become fully visible on the next screen, without laying out pages.
          const overlap = Math.min(
            extent - 1,
            settings.fontSize * Math.max(settings.lineHeight, 1.6),
          );
          const step = Math.max(1, extent - overlap);
          if (vertical) viewport.scrollLeft += (forward ? -1 : 1) * step;
          else viewport.scrollTop += (forward ? 1 : -1) * step;
          schedule();
        },
        retry: () => schedule(true),
      };
      if (anchorKey(requestedAnchor.current) !== lastEmittedAnchor.current)
        visibleAnchor.current = requestedAnchor.current;
      const onScroll = () => schedule();
      const onImageReady = () => schedule(true);
      viewport.addEventListener("scroll", onScroll, { passive: true });
      viewport.addEventListener("load", onImageReady, true);
      viewport.addEventListener("error", onImageReady, true);
      const observer = new ResizeObserver(() => schedule(true));
      observer.observe(documentElement.current);
      schedule(true);
      return () => {
        if (task.current !== null) cancelAnimationFrame(task.current);
        task.current = null;
        restorePending.current = false;
        observer.disconnect();
        viewport.removeEventListener("scroll", onScroll);
        viewport.removeEventListener("load", onImageReady, true);
        viewport.removeEventListener("error", onImageReady, true);
      };
    }, [
      book,
      source,
      ready,
      width,
      height,
      settings.direction,
      settings.fontSize,
      settings.lineHeight,
      settings.font,
      settings.latinFont,
      settings.latinScale,
      settings.textAlign,
      settings.kinsoku,
      settings.dividesByWords,
      settings.ruby,
      settings.allowsTateChuYoko,
      fontRevision,
      speechRange,
    ]);

    useLayoutEffect(() => {
      // Parent persistence echoes our own visible anchor; it must not snap a native scroll back.
      if (anchorKey(anchor) === lastEmittedAnchor.current) return;
      visibleAnchor.current = anchor;
      actions.current.retry();
    }, [anchor.blockId, anchor.offset]);

    const style: CSSProperties & Record<string, string | number> = {
      width,
      height,
      fontFamily: fontFamilies[settings.font],
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      writingMode: vertical ? "vertical-rl" : "horizontal-tb",
      textAlign: (
        {
          leading: "start",
          trailing: "end",
          center: "center",
          justify: "justify",
        } as const
      )[settings.textAlign],
      lineBreak: settings.kinsoku ? "strict" : "anywhere",
      wordBreak: settings.dividesByWords ? "normal" : "break-all",
      "--css-reader-latin-font":
        latinFontFamilies[settings.latinFont] || fontFamilies[settings.font],
      "--css-reader-latin-scale": settings.latinScale,
      "--css-reader-image-width": `${Math.max(1, width - 40)}px`,
      "--css-reader-image-height": `${Math.max(1, height - 40)}px`,
    };
    return (
      <div
        ref={root}
        data-testid="css-reader"
        data-writing-mode={vertical ? "vertical-rl" : "horizontal-tb"}
        className={`css-reader ${vertical ? "css-reader-vertical" : "css-reader-horizontal"}`}
        style={style}
        aria-label="CSS writing-mode による本文"
        tabIndex={0}
      >
        {ready && (
          <div ref={documentElement} className="css-reader-document">
            <header className="css-reader-opening">
              <h1>{openingContent(displayTitle(book.title), settings)}</h1>
              {book.subtitle && (
                <p>{openingContent(book.subtitle, settings)}</p>
              )}
              <p>{openingContent(book.authorLabel, settings)}</p>
            </header>
            {content}
          </div>
        )}
      </div>
    );
  },
);
