import {
  handleStoneCopy,
  runRangeOfSelection,
  splitGraphemes,
  textOfRunRange,
  type GlyphElement,
} from "@non-standardworld/stone-engine.js";
import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
  type PointerEvent,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { fontFamilies, type ReaderSettings } from "../types";
import type { ReaderPageData } from "./engine";
import { readerImageUrl } from "../lib/assets";
import {
  useDirectionTransition,
  type ReaderPageTurn,
} from "./useDirectionTransition";
import { createAnatomy, type AnatomyGlyph, type PageAnatomy } from "./anatomy";
import { AnatomyOverlay, AnatomyPanel } from "./ReaderAnatomy";
import type { SpeechRange } from "./speech";

function Glyphs({
  glyphs,
  prefix = "",
  sources,
  speechRange,
  speaking = false,
}: {
  glyphs: GlyphElement[];
  prefix?: string;
  sources: Map<number, string>;
  speechRange?: SpeechRange | null;
  speaking?: boolean;
}) {
  return (
    <text xmlSpace="preserve" fill="currentColor">
      {glyphs.map((glyph) => {
        const source = sources.get(glyph.runId);
        const position = source?.startsWith("body:")
          ? Number(source.slice(5))
          : -1;
        const active =
          speaking ||
          (!!speechRange &&
            position >= speechRange.globalStart &&
            position < speechRange.globalEnd);
        // Enlarge around the occupied cell's center, rather than its baseline.
        // A modest scale keeps adjacent body glyphs and ruby legible at a fixed pitch.
        const scale = active ? 1.1 : 1;
        const centerX = glyph.run.frame.x + glyph.run.frame.width / 2;
        const centerY = glyph.run.frame.y + glyph.run.frame.height / 2;
        return (
          <tspan
            key={`${prefix}${glyph.runId}`}
            data-run={prefix ? undefined : glyph.runId}
            data-source={source}
            className={active ? "reader-speech-active" : undefined}
            x={centerX + (glyph.x - centerX) * scale}
            y={centerY + (glyph.y - centerY) * scale}
            rotate={glyph.rotate || undefined}
            fontFamily={glyph.fontFamily}
            fontSize={glyph.fontSize * scale}
            fontWeight={glyph.fontWeight}
            fontStyle={glyph.fontStyle}
            style={{
              fontFeatureSettings: glyph.vertical
                ? glyph.fullWidth
                  ? '"fwid" 1, "vert" 1, "vrt2" 1'
                  : '"vert" 1, "vrt2" 1'
                : glyph.fullWidth
                  ? '"fwid" 1'
                  : undefined,
            }}
          >
            {glyph.text}
          </tspan>
        );
      })}
    </text>
  );
}

function glyphSources(
  glyphs: GlyphElement[],
  prefix: string,
  start = 0,
  reading?: string,
) {
  const sources = new Map<number, string>();
  if (reading !== undefined) {
    splitGraphemes(reading).forEach((char, index) => {
      sources.set(index, `${prefix}${start}`);
      start += char.length;
    });
  } else {
    for (const glyph of glyphs)
      sources.set(glyph.runId, `${prefix}${glyph.runId}`);
  }
  return sources;
}

function AccessibleText({
  page,
  settings,
}: {
  page: ReaderPageData;
  settings: ReaderSettings;
}) {
  const content: ReactNode[] = [];
  for (const range of page.ranges) {
    const from = Math.max(0, page.globalStart - range.start);
    const to = Math.min(range.end - range.start, page.globalEnd - range.start);
    if (to <= from) continue;
    const text =
      range.block.kind === "image" && !range.block.text
        ? "\ufffc"
        : range.block.text;
    const pieces: ReactNode[] = [];
    const plain = (start: number, end: number): ReactNode[] => {
      const parts: ReactNode[] = [];
      let at = start;
      for (const image of [...range.block.inlineImages].sort(
        (a, b) => a.start - b.start,
      )) {
        if (image.start < at || image.end > end) continue;
        parts.push(text.slice(at, image.start));
        parts.push(
          <span key={`image-${image.start}`} role="img" aria-label={image.alt}>
            {image.alt}
          </span>,
        );
        at = image.end;
      }
      parts.push(text.slice(at, end));
      return parts;
    };
    let position = from;
    const decorations = (settings.ruby ? range.block.rubies : [])
      .filter((ruby) => ruby.start >= from && ruby.end <= to)
      .sort((a, b) => a.start - b.start);
    for (const item of decorations) {
      if (item.start < position) continue;
      pieces.push(...plain(position, item.start));
      pieces.push(
        <ruby key={item.start}>
          {plain(item.start, item.end)}
          <rt>{item.reading}</rt>
        </ruby>,
      );
      position = item.end;
    }
    pieces.push(...plain(position, to));
    content.push(
      range.block.kind === "heading" ? (
        <div
          key={range.block.id}
          role="heading"
          aria-level={Math.min(6, range.block.level ?? 2)}
        >
          {pieces}
        </div>
      ) : range.block.kind === "image" && range.block.image ? (
        <div key={range.block.id} role="img" aria-label={range.block.image.alt}>
          {range.block.image.alt}
        </div>
      ) : (
        <p key={range.block.id}>{pieces}</p>
      ),
    );
  }
  return (
    <div
      className="sr-only reader-accessible-text"
      style={{ fontFamily: fontFamilies[settings.font], userSelect: "none" }}
    >
      {content}
    </div>
  );
}

export const ReaderPage = memo(function ReaderPage({
  page,
  settings,
  className,
  anatomy,
  selected,
  speechRange,
}: {
  page: ReaderPageData;
  settings: ReaderSettings;
  className?: string;
  anatomy?: PageAnatomy;
  selected?: AnatomyGlyph;
  speechRange?: SpeechRange | null;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const bodySources = new Map<number, string>();
  let sourceOffset = page.globalStart;
  page.context.runs.forEach((run, index) => {
    bodySources.set(index, `body:${sourceOffset}`);
    sourceOffset += run.char.length;
  });
  useLayoutEffect(() => {
    const container = root.current;
    return () => {
      const selection = container?.ownerDocument.getSelection();
      // Reflow replaces the selected SVG glyphs. Release that page's selection before
      // Firefox recalculates their geometry, while leaving selections elsewhere intact.
      if (
        container &&
        selection?.anchorNode &&
        selection.focusNode &&
        container.contains(selection.anchorNode) &&
        container.contains(selection.focusNode)
      ) {
        selection.removeAllRanges();
      }
    };
  }, [
    page,
    settings.direction,
    settings.fontSize,
    settings.lineHeight,
    settings.font,
    settings.ruby,
  ]);
  return (
    <div
      ref={root}
      className={className}
      data-testid="reader-leaf"
      data-start={page.globalStart}
      data-end={page.globalEnd}
      style={{
        width: page.width,
        height: page.height,
        position: "relative",
        maxWidth: "100%",
      }}
      onCopy={(event) => {
        const image = svg.current;
        const container = root.current;
        const selection = container?.ownerDocument.getSelection();
        if (
          !image ||
          !container ||
          !event.clipboardData ||
          !selection ||
          selection.rangeCount !== 1 ||
          selection.isCollapsed
        )
          return;
        const range = selection.getRangeAt(0);
        if (
          !container.contains(range.startContainer) ||
          !container.contains(range.endContainer)
        )
          return;
        // Selecting the entire page also selects its accessibility HTML. Copy the source
        // once, retaining leading/trailing whitespace and image placeholders.
        if (
          range.comparePoint(image, 0) === 0 &&
          range.comparePoint(image, image.childNodes.length) === 0
        ) {
          event.clipboardData.setData("text/plain", page.text);
          event.preventDefault();
          return;
        }
        handleStoneCopy(event, page.context, image);
      }}
    >
      {page.opening && (
        <header className="sr-only reader-opening-info">
          <h1>{page.opening.title}</h1>
          {page.opening.subtitle && <p>{page.opening.subtitle}</p>}
          <p>{page.opening.author}</p>
        </header>
      )}
      <svg
        ref={svg}
        width={page.width}
        height={page.height}
        viewBox={`0 0 ${page.width} ${page.height}`}
        aria-hidden="true"
        focusable="false"
        data-stone-direction={page.context.direction}
        data-start={page.globalStart}
        data-end={page.globalEnd}
        style={{
          display: "block",
          overflow: "visible",
          userSelect: "text",
          maxWidth: "100%",
        }}
      >
        {page.opening && (
          <g
            className="reader-opening"
            data-reader-content=""
            transform={`translate(${page.opening.x} ${page.opening.y}) scale(${page.opening.scale})`}
          >
            <Glyphs
              glyphs={page.opening.glyphs}
              prefix="opening-"
              sources={glyphSources(page.opening.glyphs, "opening:")}
            />
          </g>
        )}
        <g
          data-reader-content=""
          transform={`translate(${page.insetX} ${page.insetY})`}
        >
          {settings.showFrames && (
            <g
              className="reader-glyph-frames"
              fill="none"
              stroke="rgba(0,128,255,0.6)"
              strokeWidth="0.7"
              pointerEvents="none"
              style={{ userSelect: "none" }}
            >
              {page.context.runs
                .filter((run) => !run.isNewline)
                .map((run, index) => (
                  <rect
                    key={index}
                    x={run.frame.x}
                    y={run.frame.y}
                    width={run.frame.width}
                    height={run.frame.height}
                  />
                ))}
            </g>
          )}
          <Glyphs
            glyphs={page.glyphs}
            sources={bodySources}
            speechRange={speechRange}
          />
          <g className="reader-rubies" style={{ userSelect: "none" }}>
            {page.rubies.map((ruby) => (
              <g
                key={ruby.key}
                transform={`translate(${ruby.x} ${ruby.y}) scale(${ruby.scaleX} ${ruby.scaleY})`}
              >
                <Glyphs
                  glyphs={ruby.glyphs}
                  prefix={`${ruby.key}-`}
                  speaking={
                    !!speechRange &&
                    ruby.sourceStart >= speechRange.globalStart &&
                    ruby.sourceStart < speechRange.globalEnd
                  }
                  sources={glyphSources(
                    ruby.glyphs,
                    `ruby:${ruby.sourceStart}:`,
                    ruby.readingOffset,
                    ruby.reading,
                  )}
                />
              </g>
            ))}
          </g>
          <g style={{ userSelect: "none" }}>
            {page.emphasis.map((point, index) => (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r={point.radius}
                fill="currentColor"
              />
            ))}
          </g>
          {page.images.map((image, index) => (
            <image
              key={index}
              href={readerImageUrl(image.src)}
              x={image.x}
              y={image.y}
              width={image.width}
              height={image.height}
              preserveAspectRatio="xMidYMid meet"
            >
              <title>{image.alt}</title>
            </image>
          ))}
        </g>
        {anatomy && (
          <g transform={`translate(${page.insetX} ${page.insetY})`}>
            <AnatomyOverlay
              anatomy={anatomy}
              selected={selected}
              vertical={page.context.direction === "tbRl"}
            />
          </g>
        )}
      </svg>
      <AccessibleText page={page} settings={settings} />
    </div>
  );
});

export const ReaderPages = memo(function ReaderPages({
  pages,
  settings,
  spread,
  pageTurn,
  anatomyMode = false,
  anatomyViewport,
  speechRange,
}: {
  pages: ReaderPageData[];
  settings: ReaderSettings;
  spread: boolean;
  pageTurn?: ReaderPageTurn | null;
  anatomyMode?: boolean;
  /** A continuous reader keeps its inspector outside the scrolling SVG chunks. */
  anatomyViewport?: HTMLElement | null;
  speechRange?: SpeechRange | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  useDirectionTransition(root, pages, settings.showFrames, pageTurn, {
    direction: settings.direction,
    pageTurnAnimation: settings.pageTurnAnimation,
  });
  const anatomy = useMemo(
    () => (anatomyMode ? pages.map(createAnatomy) : []),
    [anatomyMode, pages],
  );
  const [inspection, setInspection] = useState<{
    page: ReaderPageData;
    runId: number;
  } | null>(null);
  const choices = useMemo(
    () =>
      anatomy.flatMap((pageAnatomy, index) =>
        pageAnatomy.glyphs.map((glyph) => ({ page: pages[index], glyph })),
      ),
    [anatomy, pages],
  );
  const choiceIndex = anatomyMode
    ? choices.findIndex(
        (choice) =>
          choice.page === inspection?.page &&
          choice.glyph.runId === inspection.runId,
      )
    : -1;
  const selected = choices[choiceIndex];
  // Keep the inspector on the opposite side of the touched letter. On a phone,
  // its top/bottom placement also leaves the highlighted line visible.
  let panelStyle: CSSProperties | undefined;
  if (selected && root.current) {
    const container = root.current;
    const leafIndex = pages.indexOf(selected.page);
    const svg =
      container.querySelectorAll<SVGSVGElement>(".reader-leaf > svg")[
        leafIndex
      ];
    const matrix = svg?.getScreenCTM();
    if (matrix) {
      const frame = selected.glyph.frame;
      const point = new DOMPoint(
        selected.page.insetX + frame.x + frame.width / 2,
        selected.page.insetY + frame.y + frame.height / 2,
      ).matrixTransform(matrix);
      const bounds = (anatomyViewport ?? container).getBoundingClientRect();
      panelStyle = {
        ...(point.x - bounds.x < bounds.width / 2
          ? { left: "auto", right: 10 }
          : {}),
        ...(point.y - bounds.y > bounds.height / 2
          ? { top: 10, bottom: "auto" }
          : {}),
      };
    }
  }
  const selectChoice = (index: number) => {
    const choice = choices[index];
    if (choice) setInspection({ page: choice.page, runId: choice.glyph.runId });
  };
  const inspect = (
    event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>,
  ) => {
    const container = root.current;
    if (
      !anatomyMode ||
      !container ||
      container.dataset.directionTransition ||
      container.dataset.pageTransition
    )
      return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".reader-anatomy-panel")) return;
    const leaf = target.closest<HTMLElement>('[data-testid="reader-leaf"]');
    const index = pages.findIndex(
      (page) => String(page.globalStart) === leaf?.dataset.start,
    );
    if (index < 0) return;
    const pageAnatomy = anatomy[index];
    const run = target.closest<SVGTSpanElement>("[data-run]");
    let glyph = run
      ? pageAnatomy.glyphs.find(
          (glyph) => glyph.runId === Number(run.dataset.run),
        )
      : undefined;
    if (!glyph) {
      const svg = leaf!.querySelector("svg");
      const matrix = svg?.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      );
      const x = point.x - pages[index].insetX,
        y = point.y - pages[index].insetY;
      const contains = (frame: AnatomyGlyph["frame"]) =>
        x >= frame.x &&
        x <= frame.x + frame.width &&
        y >= frame.y &&
        y <= frame.y + frame.height;
      glyph = pageAnatomy.glyphs.find((glyph) => contains(glyph.frame));
      if (!glyph) {
        const ruby = pageAnatomy.rubies.find((ruby) =>
          contains(ruby.readingFrame),
        );
        if (ruby)
          glyph = pageAnatomy.glyphs.find(
            (glyph) => glyph.runId === ruby.runIds[0],
          );
      }
    }
    if (!glyph) return;
    const runId = glyph.runId;
    setInspection((current) =>
      current?.page === pages[index] && current.runId === runId
        ? current
        : { page: pages[index], runId },
    );
  };
  useLayoutEffect(() => {
    const container = root.current;
    return () => {
      const selection = container?.ownerDocument.getSelection();
      if (
        container &&
        selection?.anchorNode &&
        selection.focusNode &&
        container.contains(selection.anchorNode) &&
        container.contains(selection.focusNode)
      )
        selection.removeAllRanges();
    };
  }, [pages]);
  const panel = anatomyMode ? (
    <AnatomyPanel
      selected={selected?.glyph}
      kinsoku={
        selected?.page.context.kinsoku ??
        pages[0]?.context.kinsoku ??
        settings.kinsoku
      }
      style={panelStyle}
      onFirst={() => selectChoice(0)}
      onPrevious={() => selectChoice(choiceIndex - 1)}
      onNext={() => selectChoice(choiceIndex + 1)}
      onClear={() => setInspection(null)}
      hasPrevious={choiceIndex > 0}
      hasNext={choiceIndex >= 0 && choiceIndex < choices.length - 1}
    />
  ) : null;
  return (
    <div
      ref={root}
      className={`reader-pages${spread ? " spread" : ""}`}
      data-direction={pages[0]?.context.direction}
      data-anatomy={anatomyMode || undefined}
      onPointerMove={(event) => {
        if (event.pointerType !== "touch") inspect(event);
      }}
      onClick={inspect}
      onKeyDown={(event) => {
        if (anatomyMode && event.key === "Escape") {
          setInspection(null);
          event.stopPropagation();
        }
      }}
      onCopy={(event) => {
        if (event.defaultPrevented || pages.length < 2 || !event.clipboardData)
          return;
        const container = event.currentTarget;
        const selection = container.ownerDocument.getSelection();
        if (!selection || selection.rangeCount !== 1 || selection.isCollapsed)
          return;
        const range = selection.getRangeAt(0);
        if (
          !container.contains(range.startContainer) ||
          !container.contains(range.endContainer)
        )
          return;
        const fragments = [...container.querySelectorAll("svg")].map(
          (svg, index) => {
            const fullStart = range.comparePoint(svg, 0) === 0;
            const fullEnd =
              range.comparePoint(svg, svg.childNodes.length) === 0;
            if (fullStart && fullEnd) return pages[index].text;
            const runs = runRangeOfSelection(svg, range);
            return runs
              ? textOfRunRange(
                  pages[index].context,
                  fullStart ? 0 : runs[0],
                  fullEnd ? pages[index].context.runs.length : runs[1],
                )
              : "";
          },
        );
        if (fragments.some(Boolean)) {
          event.clipboardData.setData("text/plain", fragments.join(""));
          event.preventDefault();
        }
      }}
    >
      {pages.map((page, index) => (
        <ReaderPage
          key={index}
          page={page}
          settings={settings}
          className="reader-leaf"
          anatomy={anatomy[index]}
          selected={selected?.page === page ? selected.glyph : undefined}
          speechRange={speechRange}
        />
      ))}
      {spread && pages.length === 1 && (
        <div
          className="reader-leaf reader-blank-page"
          aria-hidden="true"
          style={{ width: pages[0].width, height: pages[0].height }}
        />
      )}
      {anatomyViewport && panel ? createPortal(panel, anatomyViewport) : panel}
    </div>
  );
});
