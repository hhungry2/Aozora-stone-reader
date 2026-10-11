import { useCallback, useEffect, useMemo, useState } from "react";
import type { Anchor, Book, ReaderSettings } from "../types";
import type { PaginationEngine, ReaderPageData } from "./engine";
import { loadReaderFont } from "./fonts";
import { preloadPages, type PreloadProgress } from "./preload";

interface Options {
  book: Book;
  settings: ReaderSettings;
  width: number;
  height: number;
  anchor: Anchor | null;
  pageCount?: 1 | 2;
  enabled?: boolean;
}
interface Result {
  page: ReaderPageData | null;
  pages: ReaderPageData[];
  loading: boolean;
  error: string | null;
  nextAnchor: Anchor | null;
  previousAnchor: Anchor | null;
  progress: number;
  isEnd: boolean;
  retry: () => void;
  preload: PreloadProgress | null;
}

interface StoneRuntime {
  PaginationEngine: typeof import("./engine").PaginationEngine;
  FixedMeasurer: typeof import("@non-standardworld/stone-engine.js").FixedMeasurer;
  getSharedCanvasMeasurer: typeof import("@non-standardworld/stone-engine.js").getSharedCanvasMeasurer;
}

interface PaginationState {
  engine: PaginationEngine | null;
  anchorKey: string;
  retryRevision: number;
  pageCount: number;
  pages: ReaderPageData[];
  previousAnchor: Anchor | null;
  error: string | null;
}

const emptyPagination: PaginationState = {
  engine: null,
  anchorKey: "",
  retryRevision: -1,
  pageCount: 1,
  pages: [],
  previousAnchor: null,
  error: null,
};

export function usePagination({
  book,
  settings,
  width,
  height,
  anchor,
  pageCount = 1,
  enabled = true,
}: Options): Result {
  const [fontRevision, setFontRevision] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const [runtimeState, setRuntimeState] = useState<{
    runtime: StoneRuntime | null;
    error: string | null;
    retryRevision: number;
  }>({ runtime: null, error: null, retryRevision: -1 });
  const retry = useCallback(
    () => setRetryRevision((revision) => revision + 1),
    [],
  );
  useEffect(() => {
    if (!enabled) {
      setRuntimeState({ runtime: null, error: null, retryRevision: -1 });
      return;
    }
    let active = true;
    setRuntimeState({ runtime: null, error: null, retryRevision });
    // A reader opened in CSS mode must not download or initialize Stone.
    void Promise.all([
      import("./engine"),
      import("@non-standardworld/stone-engine.js"),
    ]).then(
      ([engineModule, stoneModule]) => {
        if (!active) return;
        setRuntimeState({
          runtime: {
            PaginationEngine: engineModule.PaginationEngine,
            FixedMeasurer: stoneModule.FixedMeasurer,
            getSharedCanvasMeasurer: stoneModule.getSharedCanvasMeasurer,
          },
          error: null,
          retryRevision,
        });
      },
      (error: unknown) => {
        if (!active) return;
        setRuntimeState({
          runtime: null,
          error:
            error instanceof Error
              ? error.message
              : "組版ライブラリを読み込めませんでした。",
          retryRevision,
        });
      },
    );
    return () => {
      active = false;
    };
  }, [enabled, retryRevision]);
  const runtime =
    enabled && runtimeState.retryRevision === retryRevision
      ? runtimeState.runtime
      : null;
  const runtimeError =
    enabled && runtimeState.retryRevision === retryRevision
      ? runtimeState.error
      : null;
  useEffect(() => {
    if (!enabled || !runtime) return;
    if (settings.font === "serif" || settings.font === "sans") return;
    let active = true;
    const sample = [
      book.title,
      book.subtitle,
      book.authorLabel,
      book.blocks
        .slice(0, 12)
        .map((block) => block.text)
        .join(""),
    ]
      .join("")
      .slice(0, 500);
    void loadReaderFont(settings.font, sample).then(() => {
      if (active) {
        runtime.getSharedCanvasMeasurer()?.invalidate();
        setFontRevision((revision) => revision + 1);
      }
    });
    return () => {
      active = false;
    };
  }, [enabled, runtime, book, settings.font]);
  useEffect(() => {
    if (!enabled || !runtime) return;
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
  }, [enabled, runtime]);
  const { engine, error: engineError } = useMemo(() => {
    if (!enabled || !runtime) return { engine: null, error: null };
    try {
      return {
        engine: new runtime.PaginationEngine(
          book,
          settings,
          width,
          height,
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
    enabled,
    runtime,
    book,
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
    settings.paginationMode,
    width,
    height,
    fontRevision,
  ]);
  const [state, setState] = useState<PaginationState>(emptyPagination);
  const anchorKey = `${anchor?.blockId ?? ""}:${anchor?.offset ?? 0}`;
  useEffect(() => {
    if (!enabled || !engine) {
      // Drop the old engine and its page caches when leaving Stone mode.
      setState(emptyPagination);
      return;
    }
    if (width < 80 || height < 80) return;
    const task = window.setTimeout(() => {
      try {
        const pages = engine.pagesAt(anchor, pageCount);
        const previousAnchor = engine.previousAnchor(pages[0], pageCount);
        setState({
          engine,
          anchorKey,
          retryRevision,
          pageCount,
          pages,
          previousAnchor,
          error: null,
        });
      } catch (error) {
        setState({
          engine,
          anchorKey,
          retryRevision,
          pageCount,
          pages: [],
          previousAnchor: null,
          error:
            error instanceof Error
              ? error.message
              : "本文を組版できませんでした。",
        });
      }
    }, 0);
    return () => window.clearTimeout(task);
  }, [enabled, engine, anchorKey, retryRevision, width, height, pageCount]);
  const error =
    runtimeError ??
    engineError ??
    (state.engine === engine ? state.error : null);
  const loading =
    enabled &&
    !runtimeError &&
    !engineError &&
    (!engine ||
      state.engine !== engine ||
      state.anchorKey !== anchorKey ||
      state.retryRevision !== retryRevision ||
      state.pageCount !== pageCount);
  const pages = engine ? state.pages : [];
  const page = pages[0] ?? null;
  const last = pages.at(-1);
  const [preparation, setPreparation] = useState<{
    engine: PaginationEngine;
    anchorKey: string;
    progress: PreloadProgress;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !engine || loading || error || !last) {
      // Release the previous full-book cache even if the new layout fails.
      setPreparation(null);
      return;
    }
    return preloadPages(
      engine,
      last.globalEnd,
      settings.paginationMode,
      (progress) => {
        setPreparation({ engine, anchorKey, progress });
      },
    );
  }, [
    enabled,
    engine,
    anchorKey,
    loading,
    error,
    last,
    settings.paginationMode,
    retryRevision,
  ]);
  const preload =
    enabled &&
    engine &&
    preparation?.engine === engine &&
    preparation.anchorKey === anchorKey
      ? preparation.progress
      : null;
  const isEnd = Boolean(
    engine && last && last.globalEnd >= engine.index.text.length,
  );
  return {
    page,
    pages,
    loading,
    error: enabled ? error : null,
    nextAnchor: last && !isEnd ? last.end : null,
    previousAnchor: engine ? state.previousAnchor : null,
    progress:
      page && engine && engine.index.text.length
        ? page.globalStart / engine.index.text.length
        : 0,
    isEnd,
    retry,
    preload,
  };
}
