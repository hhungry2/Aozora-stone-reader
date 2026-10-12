import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Anchor, Book, ReaderSettings } from "../types";
import type { ReaderPageData } from "./engine";
import type { ScrollLayoutEngine } from "./scrollLayout";
import { ReaderPages } from "./ReaderPage";
import { loadReaderFont } from "./fonts";
import {
  ScrollExtentIndex,
  sourceFrame,
  visibleSourceRange,
} from "./scrollGeometry";

export interface ScrollReaderLocation {
  page: {
    start: Anchor;
    end: Anchor;
    globalStart: number;
    globalEnd: number;
    text: string;
  } | null;
  loading: boolean;
  error: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
  progress: number;
  isEnd: boolean;
}

export interface ScrollReaderHandle {
  advance: (next: boolean) => void;
  retry: () => void;
  getAnchor: () => Anchor | null;
  getLocation: () => ScrollReaderLocation | null;
}

interface ScrollReaderProps {
  book: Book;
  settings: ReaderSettings;
  width: number;
  height: number;
  anchor: Anchor | null;
  onLocationChange: (location: ScrollReaderLocation) => void;
  anatomyMode?: boolean;
}

interface Runtime {
  ScrollLayoutEngine: typeof import("./scrollLayout").ScrollLayoutEngine;
  anchorAt: typeof import("./engine").anchorAt;
  positionOf: typeof import("./engine").positionOf;
  FixedMeasurer: typeof import("@non-standardworld/stone-engine.js").FixedMeasurer;
  getSharedCanvasMeasurer: typeof import("@non-standardworld/stone-engine.js").getSharedCanvasMeasurer;
}

interface Session {
  engine: ScrollLayoutEngine;
  runtime: Runtime;
  sizes: ScrollExtentIndex;
  pages: Map<number, ReaderPageData>;
  desired: number[];
  queue: number[];
  vertical: boolean;
  frame: number;
  timer: number;
  notifyTimer: number;
  notifiedAt: number;
  restore: { position: number; pixelOffset: number } | null;
  cancelled: boolean;
  error: string | null;
}

interface Snapshot {
  session: Session | null;
  total: number;
  pages: { index: number; page: ReaderPageData; offset: number }[];
  visibleChunk: number;
}

const emptySnapshot: Snapshot = {
  session: null,
  total: 1,
  pages: [],
  visibleChunk: 0,
};
const keyOf = (anchor: Anchor | null) =>
  `${anchor?.blockId ?? ""}:${anchor?.offset ?? 0}`;
const maximumMountedChunks = 7;

const ScrollChunkBody = memo(function ScrollChunkBody({
  page,
  settings,
  anatomyMode,
  anatomyViewport,
}: {
  page: ReaderPageData;
  settings: ReaderSettings;
  anatomyMode: boolean;
  anatomyViewport: HTMLElement | null;
}) {
  const pages = useMemo(() => [page], [page]);
  return (
    <ReaderPages
      pages={pages}
      settings={settings}
      spread={false}
      anatomyMode={anatomyMode}
      anatomyViewport={anatomyViewport}
    />
  );
});

function scrollDistance(element: HTMLElement, vertical: boolean) {
  return Math.max(0, vertical ? -element.scrollLeft : element.scrollTop);
}

function setScrollDistance(
  element: HTMLElement,
  vertical: boolean,
  distance: number,
  behavior: ScrollBehavior = "instant",
) {
  if (vertical)
    element.scrollTo({ left: -Math.max(0, distance), top: 0, behavior });
  else element.scrollTo({ top: Math.max(0, distance), left: 0, behavior });
}

export const ScrollReader = forwardRef<ScrollReaderHandle, ScrollReaderProps>(
  function ScrollReader(
    {
      book,
      settings,
      width,
      height,
      anchor,
      onLocationChange,
      anatomyMode = false,
    },
    forwardedRef,
  ) {
    const host = useRef<HTMLDivElement>(null);
    const root = useRef<HTMLDivElement>(null);
    const track = useRef<HTMLDivElement>(null);
    const sessionRef = useRef<Session | null>(null);
    const callback = useRef(onLocationChange);
    callback.current = onLocationChange;
    const anchorProp = useRef(anchor);
    anchorProp.current = anchor;
    const lastEmitted = useRef("");
    const lastExternal = useRef("");
    const lastVisible = useRef<{
      book: Book;
      position: number;
      pixelOffset: number;
      direction: string;
    } | null>(null);
    const [retryRevision, setRetryRevision] = useState(0);
    const [fontRevision, setFontRevision] = useState(0);
    const [runtimeState, setRuntimeState] = useState<{
      runtime: Runtime | null;
      error: string | null;
    }>({ runtime: null, error: null });
    const [viewport, setViewport] = useState({ width, height });
    const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
    const [activeAnatomyChunk, setActiveAnatomyChunk] = useState<number | null>(
      null,
    );
    const vertical = settings.direction === "tbRl";
    const scrollSettings = useMemo(
      () => ({ ...settings, pageTurnAnimation: false }),
      [settings],
    );

    useEffect(() => {
      let active = true;
      setRuntimeState({ runtime: null, error: null });
      void Promise.all([
        import("./scrollLayout"),
        import("./engine"),
        import("@non-standardworld/stone-engine.js"),
      ]).then(
        ([scrollModule, engineModule, stoneModule]) => {
          if (active)
            setRuntimeState({
              runtime: {
                ScrollLayoutEngine: scrollModule.ScrollLayoutEngine,
                anchorAt: engineModule.anchorAt,
                positionOf: engineModule.positionOf,
                FixedMeasurer: stoneModule.FixedMeasurer,
                getSharedCanvasMeasurer: stoneModule.getSharedCanvasMeasurer,
              },
              error: null,
            });
        },
        (error: unknown) => {
          if (active)
            setRuntimeState({
              runtime: null,
              error:
                error instanceof Error
                  ? error.message
                  : "組版ライブラリを読み込めませんでした。",
            });
        },
      );
      return () => {
        active = false;
      };
    }, [retryRevision]);

    const runtime = runtimeState.runtime;
    useEffect(() => {
      if (!runtime || settings.font === "serif" || settings.font === "sans")
        return;
      let active = true;
      const sample = [
        book.title,
        book.subtitle,
        book.authorLabel,
        ...book.blocks.slice(0, 12).map((block) => block.text),
      ]
        .join("")
        .slice(0, 500);
      void loadReaderFont(settings.font, sample).then(() => {
        if (!active) return;
        runtime.getSharedCanvasMeasurer()?.invalidate();
        setFontRevision((revision) => revision + 1);
      });
      return () => {
        active = false;
      };
    }, [runtime, book, settings.font]);

    useEffect(() => {
      if (!runtime) return;
      let active = true;
      const update = () => {
        if (!active) return;
        runtime.getSharedCanvasMeasurer()?.invalidate();
        setFontRevision((revision) => revision + 1);
      };
      void document.fonts?.ready.then(update);
      document.fonts?.addEventListener("loadingdone", update);
      return () => {
        active = false;
        document.fonts?.removeEventListener("loadingdone", update);
      };
    }, [runtime]);

    useLayoutEffect(() => {
      const element = root.current;
      if (!element) return;
      let frame = 0;
      const measure = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const next = {
            width: element.clientWidth,
            height: element.clientHeight,
          };
          if (next.width > 0 && next.height > 0)
            setViewport((previous) =>
              previous.width === next.width && previous.height === next.height
                ? previous
                : next,
            );
        });
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
      };
    }, [width, height, vertical]);

    const { engine, error: engineError } = useMemo(() => {
      if (!runtime || viewport.width < 80 || viewport.height < 80)
        return { engine: null, error: null };
      try {
        return {
          engine: new runtime.ScrollLayoutEngine(
            book,
            settings,
            viewport.width,
            viewport.height,
            runtime.getSharedCanvasMeasurer() ?? new runtime.FixedMeasurer(),
          ),
          error: null,
        };
      } catch (error) {
        return {
          engine: null,
          error:
            error instanceof Error
              ? error.message
              : "本文を組版できませんでした。",
        };
      }
    }, [
      runtime,
      book,
      viewport.width,
      viewport.height,
      settings.direction,
      settings.fontSize,
      settings.lineHeight,
      settings.font,
      settings.latinFont,
      settings.latinScale,
      settings.punctuationMode,
      settings.textAlign,
      settings.directionAlign,
      settings.kinsoku,
      settings.dividesByWords,
      settings.allowsTateChuYoko,
      settings.ruby,
      fontRevision,
    ]);

    const currentLocation = useCallback(
      (session: Session): ScrollReaderLocation => {
        const element = root.current;
        if (!element)
          return {
            page: null,
            loading: true,
            error: session.error,
            hasNext: false,
            hasPrevious: false,
            progress: 0,
            isEnd: false,
          };
        const distance = scrollDistance(element, session.vertical);
        const extent = session.vertical
          ? element.clientWidth
          : element.clientHeight;
        let start: number | undefined,
          end = 0;
        for (const [index, page] of [...session.pages].sort(
          (left, right) => left[0] - right[0],
        )) {
          const offset = session.sizes.prefix(index);
          const range = visibleSourceRange(
            page,
            distance - offset,
            distance + extent - offset,
          );
          if (range) {
            start ??= range.start;
            end = Math.max(end, range.end);
          }
        }
        const first = session.sizes.find(distance);
        const last = session.sizes.find(distance + extent);
        const hasSourceRange = start !== undefined;
        const ready = session.pages.has(first) && session.pages.has(last);
        const fallback = session.engine.chunks[first]?.start ?? 0;
        start ??= fallback;
        end = Math.max(start, end);
        const startAnchor = session.runtime.anchorAt(
          session.engine.index,
          start,
        );
        const endAnchor = session.runtime.anchorAt(session.engine.index, end);
        const page = {
          start: startAnchor,
          end: endAnchor,
          globalStart: start,
          globalEnd: end,
          text: session.engine.index.text.slice(start, end),
        };
        const isEnd = ready && distance + extent >= session.sizes.total - 2;
        if (ready && hasSourceRange) {
          const pageIndex = session.engine.chunkAtPosition(start);
          const chunk = session.pages.get(pageIndex);
          const frame = chunk && sourceFrame(chunk, start);
          lastVisible.current = {
            book,
            position: start,
            pixelOffset: frame
              ? distance - session.sizes.prefix(pageIndex) - frame.offset
              : 0,
            direction: session.vertical ? "tbRl" : "lrTb",
          };
        }
        return {
          page,
          loading: !ready && !session.error,
          error: session.error,
          hasNext: !isEnd,
          hasPrevious: distance > 1,
          progress: isEnd
            ? 1
            : start / Math.max(1, session.engine.index.text.length),
          isEnd,
        };
      },
      [book],
    );

    const notify = useCallback(
      (session: Session, immediate = false) => {
        if (session.cancelled) return;
        const publish = () => {
          session.notifyTimer = 0;
          session.notifiedAt = performance.now();
          const location = currentLocation(session);
          if (location.page && !location.loading)
            lastEmitted.current = keyOf(location.page.start);
          callback.current(location);
        };
        const remaining = 120 - (performance.now() - session.notifiedAt);
        if (immediate || remaining <= 0) {
          clearTimeout(session.notifyTimer);
          publish();
        } else if (!session.notifyTimer)
          session.notifyTimer = window.setTimeout(publish, remaining);
      },
      [currentLocation],
    );

    const commit = useCallback(
      (session: Session) => {
        if (session.cancelled) return;
        const element = root.current;
        setSnapshot({
          session,
          total: session.sizes.total,
          visibleChunk: session.sizes.find(
            element ? scrollDistance(element, session.vertical) : 0,
          ),
          pages: session.desired.flatMap((index) => {
            const page = session.pages.get(index);
            return page
              ? [{ index, page, offset: session.sizes.prefix(index) }]
              : [];
          }),
        });
        notify(session);
      },
      [notify],
    );

    // Functions share the current session through refs, so native scroll listeners
    // remain stable while source positions are persisted by the parent.
    const refreshRef = useRef<(session: Session) => void>(() => {});
    const workRef = useRef<(session: Session) => void>(() => {});

    const resizeTrack = useCallback((session: Session) => {
      const content = track.current;
      if (!content) return;
      if (session.vertical)
        content.style.width = `${Math.max(1, session.sizes.total)}px`;
      else content.style.height = `${Math.max(1, session.sizes.total)}px`;
    }, []);

    workRef.current = (session) => {
      session.timer = 0;
      if (session.cancelled || !root.current) return;
      try {
        const element = root.current;
        const distance = scrollDistance(element, session.vertical);
        const restore = session.restore;
        const index = restore
          ? session.engine.chunkAtPosition(restore.position)
          : session.queue.shift();
        if (index === undefined) {
          commit(session);
          return;
        }
        const focus = session.sizes.find(distance);
        const within = distance - session.sizes.prefix(focus);
        const previousExtent = session.sizes.extent(index);
        const page = session.engine.layoutChunk(index);
        session.pages.set(index, page);
        if (restore) session.desired = [index];
        const actualExtent = session.vertical ? page.width : page.height;
        const delta = session.sizes.update(index, actualExtent);
        resizeTrack(session);
        if (restore) {
          const frame =
            restore.position === 0 ? null : sourceFrame(page, restore.position);
          setScrollDistance(
            element,
            session.vertical,
            session.sizes.prefix(index) +
              (frame?.offset ?? 0) +
              restore.pixelOffset,
          );
          session.restore = null;
        } else if (index < focus && Math.abs(delta) > 0.01) {
          setScrollDistance(element, session.vertical, distance + delta);
        } else if (index === focus && Math.abs(delta) > 0.01) {
          setScrollDistance(
            element,
            session.vertical,
            session.sizes.prefix(index) +
              (within * actualExtent) / previousExtent,
          );
        }
        refreshRef.current(session);
      } catch (error) {
        session.error =
          error instanceof Error
            ? error.message
            : "本文を組版できませんでした。";
        session.queue = [];
        session.restore = null;
        commit(session);
        notify(session, true);
      }
    };

    refreshRef.current = (session) => {
      if (session.cancelled || !root.current) return;
      const element = root.current;
      const distance = scrollDistance(element, session.vertical);
      const viewportExtent = session.vertical
        ? element.clientWidth
        : element.clientHeight;
      const first = session.sizes.find(
        Math.max(0, distance - viewportExtent * 0.7),
      );
      const last = session.sizes.find(distance + viewportExtent * 1.7);
      const center = session.sizes.find(distance);
      // Save the visible source before a subsequent direction/size render changes
      // the native scroll axes. Reading the DOM in an effect cleanup is too late.
      currentLocation(session);
      const from = Math.max(
        first,
        Math.min(center, last - maximumMountedChunks + 1),
      );
      session.desired = Array.from(
        { length: Math.min(maximumMountedChunks, last - from + 1) },
        (_, offset) => from + offset,
      );
      const needed = session.desired.filter(
        (index) => !session.pages.has(index),
      );
      session.queue = needed.sort(
        (left, right) => Math.abs(left - center) - Math.abs(right - center),
      );
      const keep = new Set(session.desired);
      for (const index of session.pages.keys())
        if (!keep.has(index)) session.pages.delete(index);
      commit(session);
      if ((session.restore || session.queue.length) && !session.timer)
        session.timer = window.setTimeout(() => workRef.current(session), 0);
    };

    useLayoutEffect(() => {
      if (!engine || !runtime) return;
      const saved = lastVisible.current;
      const canRestore =
        saved?.book === book &&
        (!anchorProp.current ||
          keyOf(anchorProp.current) === lastEmitted.current);
      const position = canRestore
        ? saved.position
        : runtime.positionOf(engine.index, anchorProp.current);
      const session: Session = {
        engine,
        runtime,
        sizes: new ScrollExtentIndex(
          engine.chunks.map((chunk) => chunk.estimatedExtent),
        ),
        pages: new Map(),
        desired: [],
        queue: [],
        vertical,
        frame: 0,
        timer: 0,
        notifyTimer: 0,
        notifiedAt: 0,
        cancelled: false,
        error: null,
        restore: {
          position,
          pixelOffset:
            canRestore && saved.direction === settings.direction
              ? Math.max(0, Math.min(settings.fontSize, saved.pixelOffset))
              : 0,
        },
      };
      sessionRef.current = session;
      lastExternal.current = keyOf(anchorProp.current);
      setActiveAnatomyChunk(null);
      setSnapshot(emptySnapshot);
      resizeTrack(session);
      callback.current({
        page: null,
        loading: true,
        error: null,
        hasNext: false,
        hasPrevious: position > 0,
        progress: position / Math.max(1, engine.index.text.length),
        isEnd: false,
      });
      session.timer = window.setTimeout(() => workRef.current(session), 0);
      return () => {
        session.cancelled = true;
        clearTimeout(session.timer);
        clearTimeout(session.notifyTimer);
        cancelAnimationFrame(session.frame);
        if (sessionRef.current === session) sessionRef.current = null;
      };
    }, [
      engine,
      runtime,
      book,
      vertical,
      settings.direction,
      resizeTrack,
      currentLocation,
    ]);

    const anchorKey = keyOf(anchor);
    useLayoutEffect(() => {
      const session = sessionRef.current;
      if (!session) return;
      if (anchorKey === lastEmitted.current) {
        lastExternal.current = anchorKey;
        return;
      }
      if (anchorKey === lastExternal.current) return;
      lastExternal.current = anchorKey;
      session.restore = {
        position: session.runtime.positionOf(session.engine.index, anchor),
        pixelOffset: 0,
      };
      session.error = null;
      if (!session.timer)
        session.timer = window.setTimeout(() => workRef.current(session), 0);
    }, [anchorKey, anchor]);

    useEffect(() => {
      const error = runtimeState.error ?? engineError;
      if (error)
        callback.current({
          page: null,
          loading: false,
          error,
          hasNext: false,
          hasPrevious: false,
          progress: 0,
          isEnd: false,
        });
    }, [runtimeState.error, engineError]);

    const scheduleScroll = useCallback(() => {
      const session = sessionRef.current;
      if (!session || session.frame) return;
      session.frame = requestAnimationFrame(() => {
        session.frame = 0;
        refreshRef.current(session);
      });
    }, []);

    useEffect(() => {
      const element = root.current;
      if (!element) return;
      const wheel = (event: WheelEvent) => {
        if (
          !vertical ||
          event.ctrlKey ||
          !(event.target instanceof Element) ||
          event.target.closest(".reader-anatomy-panel")
        )
          return;
        if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.shiftKey)
          return;
        const scale =
          event.deltaMode === 1
            ? settings.fontSize * settings.lineHeight
            : event.deltaMode === 2
              ? element.clientWidth
              : 1;
        element.scrollLeft -= event.deltaY * scale;
        event.preventDefault();
      };
      element.addEventListener("wheel", wheel, { passive: false });
      const ended = () => {
        const session = sessionRef.current;
        if (session) notify(session, true);
      };
      element.addEventListener("scrollend", ended);
      return () => {
        element.removeEventListener("wheel", wheel);
        element.removeEventListener("scrollend", ended);
      };
    }, [vertical, settings.fontSize, settings.lineHeight, notify]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        advance: (next) => {
          const session = sessionRef.current,
            element = root.current;
          if (!session || !element) return;
          const viewportExtent = session.vertical
            ? element.clientWidth
            : element.clientHeight;
          const step = Math.max(
            settings.fontSize,
            viewportExtent - settings.fontSize * settings.lineHeight,
          );
          const target = Math.min(
            Math.max(0, session.sizes.total - viewportExtent),
            scrollDistance(element, session.vertical) + (next ? step : -step),
          );
          const reduced = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          setScrollDistance(
            element,
            session.vertical,
            target,
            reduced ? "instant" : "smooth",
          );
          scheduleScroll();
        },
        retry: () => setRetryRevision((revision) => revision + 1),
        getLocation: () => {
          const session = sessionRef.current;
          return session ? currentLocation(session) : null;
        },
        getAnchor: () => {
          const session = sessionRef.current;
          const current = session
            ? (currentLocation(session).page?.start ?? null)
            : anchorProp.current;
          if (current) lastEmitted.current = keyOf(current);
          return current;
        },
      }),
      [settings.fontSize, settings.lineHeight, scheduleScroll, currentLocation],
    );

    const ready = snapshot.session?.engine === engine;
    const visiblePages = ready ? snapshot.pages : [];
    const inspectionChunk =
      activeAnatomyChunk !== null &&
      visiblePages.some((entry) => entry.index === activeAnatomyChunk)
        ? activeAnatomyChunk
        : snapshot.visibleChunk;
    const trackStyle: CSSProperties = vertical
      ? {
          position: "relative",
          width: Math.max(viewport.width, ready ? snapshot.total : 1),
          height: viewport.height,
          direction: "ltr",
          transitionProperty: "none",
        }
      : {
          position: "relative",
          height: Math.max(viewport.height, ready ? snapshot.total : 1),
          width: viewport.width,
          direction: "ltr",
          transitionProperty: "none",
        };

    return (
      <div
        ref={host}
        className="reader-scroll-wrap"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <div
          ref={root}
          className="scroll-reader"
          data-testid="scroll-reader"
          data-direction={settings.direction}
          data-anatomy={anatomyMode || undefined}
          data-mounted-chunks={visiblePages.length}
          data-chunk-count={engine?.chunks.length ?? 0}
          data-cache-size={engine?.cacheSize ?? 0}
          aria-label={
            vertical ? "本文を左右にスクロール" : "本文を上下にスクロール"
          }
          tabIndex={0}
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            overflowX: vertical ? "auto" : "hidden",
            overflowY: vertical ? "hidden" : "auto",
            direction: vertical ? "rtl" : "ltr",
            overflowAnchor: "none",
            overscrollBehavior: "contain",
            scrollbarWidth: "thin",
          }}
          onScroll={scheduleScroll}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown")
              event.stopPropagation();
          }}
          onCopy={(event) => {
            if (event.defaultPrevented || !event.clipboardData) return;
            const selection = event.currentTarget.ownerDocument.getSelection();
            if (
              !selection ||
              selection.isCollapsed ||
              selection.rangeCount !== 1
            )
              return;
            const range = selection.getRangeAt(0);
            if (
              !event.currentTarget.contains(range.startContainer) ||
              !event.currentTarget.contains(range.endContainer)
            )
              return;
            const leaves = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                '[data-testid="reader-leaf"]',
              ),
            ];
            const touched = leaves.filter((leaf) => range.intersectsNode(leaf));
            if (!touched.length || !sessionRef.current) return;
            let from: number | undefined,
              to = 0;
            for (const leaf of touched) {
              const svg = leaf.querySelector("svg");
              if (!svg) continue;
              const includesStart = range.comparePoint(svg, 0) === 0;
              const includesEnd =
                range.comparePoint(svg, svg.childNodes.length) === 0;
              const sourceStart = Number(leaf.dataset.start);
              const sourceEnd = Number(leaf.dataset.end);
              // Newlines and image placeholders do not always have a tspan.
              // A complete SVG selection still represents its entire source.
              if (includesStart) from ??= sourceStart;
              if (includesStart && includesEnd) {
                to = Math.max(to, sourceEnd);
                continue;
              }
              for (const glyph of leaf.querySelectorAll<SVGTSpanElement>(
                'tspan[data-source^="body:"]',
              )) {
                if (!range.intersectsNode(glyph)) continue;
                const position = Number(glyph.dataset.source?.slice(5));
                const text = glyph.firstChild;
                let localFrom = 0,
                  localTo = glyph.textContent?.length ?? 0;
                if (text === range.startContainer)
                  localFrom = range.startOffset;
                if (text === range.endContainer) localTo = range.endOffset;
                if (localTo <= localFrom) continue;
                from ??= position + localFrom;
                to = Math.max(to, position + localTo);
              }
              if (includesEnd) to = Math.max(to, sourceEnd);
            }
            if (from !== undefined && to > from) {
              event.clipboardData.setData(
                "text/plain",
                sessionRef.current.engine.index.text.slice(from, to),
              );
              event.preventDefault();
            }
          }}
        >
          <div ref={track} className="scroll-reader-track" style={trackStyle}>
            {visiblePages.map(({ index, page, offset }) => (
              <div
                key={`${page.globalStart}-${page.globalEnd}`}
                className="scroll-reader-chunk"
                data-scroll-chunk={index}
                data-start={page.globalStart}
                data-end={page.globalEnd}
                style={{
                  position: "absolute",
                  top: vertical ? 0 : offset,
                  ...(vertical ? { right: offset } : { left: 0 }),
                  width: page.width,
                  height: page.height,
                }}
                onPointerDownCapture={() => {
                  if (anatomyMode) setActiveAnatomyChunk(index);
                }}
                onPointerMoveCapture={(event) => {
                  if (anatomyMode && event.pointerType !== "touch")
                    setActiveAnatomyChunk(index);
                }}
              >
                <ScrollChunkBody
                  page={page}
                  settings={scrollSettings}
                  anatomyMode={anatomyMode && inspectionChunk === index}
                  anatomyViewport={host.current}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },
);
