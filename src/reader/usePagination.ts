import { FixedMeasurer, getSharedCanvasMeasurer } from '@non-standardworld/stone-engine.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Anchor, Book, ReaderSettings } from '../types';
import { PaginationEngine, type ReaderPageData } from './engine';
import { loadReaderFont } from './fonts';

interface Options { book: Book; settings: ReaderSettings; width: number; height: number; anchor: Anchor | null; pageCount?: 1 | 2 }
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
}

export function usePagination({ book, settings, width, height, anchor, pageCount = 1 }: Options): Result {
  const [fontRevision, setFontRevision] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const retry = useCallback(() => setRetryRevision((revision) => revision + 1), []);
  useEffect(() => {
    if (settings.font === 'serif' || settings.font === 'sans') return;
    let active = true;
    const sample = book.blocks.slice(0, 12).map((block) => block.text).join('').slice(0, 500);
    void loadReaderFont(settings.font, sample).then(() => {
      if (active) {
        getSharedCanvasMeasurer()?.invalidate();
        setFontRevision((revision) => revision + 1);
      }
    });
    return () => { active = false; };
  }, [book, settings.font]);
  useEffect(() => {
    let active = true;
    const update = () => {
      if (!active) return;
      getSharedCanvasMeasurer()?.invalidate();
      setFontRevision((revision) => revision + 1);
    };
    void document.fonts?.ready.then(update);
    document.fonts?.addEventListener('loadingdone', update);
    return () => { active = false; document.fonts?.removeEventListener('loadingdone', update); };
  }, []);
  const engine = useMemo(() => new PaginationEngine(book, settings, width, height, getSharedCanvasMeasurer() ?? new FixedMeasurer()),
    [book, settings.direction, settings.fontSize, settings.lineHeight, settings.font, settings.latinFont,
      settings.latinScale, settings.punctuationMode, settings.textAlign, settings.directionAlign,
      settings.kinsoku, settings.dividesByWords, settings.allowsTateChuYoko, settings.ruby, width, height, fontRevision]);
  const [state, setState] = useState<{ engine: PaginationEngine | null; anchorKey: string; retryRevision: number; pageCount: number; pages: ReaderPageData[]; previousAnchor: Anchor | null; error: string | null }>({
    engine: null, anchorKey: '', retryRevision: -1, pageCount: 1, pages: [], previousAnchor: null, error: null,
  });
  const anchorKey = `${anchor?.blockId ?? ''}:${anchor?.offset ?? 0}`;
  useEffect(() => {
    if (width < 80 || height < 80) return;
    const task = window.setTimeout(() => {
      try {
        const pages = engine.pagesAt(anchor, pageCount);
        const previousAnchor = engine.previousAnchor(pages[0], pageCount);
        setState({ engine, anchorKey, retryRevision, pageCount, pages, previousAnchor, error: null });
        const last = pages[pages.length - 1];
        // Cache one forward page without rendering the rest of the book.
        if (last.globalEnd < engine.index.text.length) {
          window.setTimeout(() => { try { engine.pageAtPosition(last.globalEnd); } catch { /* surfaced when navigated to */ } }, 0);
        }
      } catch (error) {
        setState({ engine, anchorKey, retryRevision, pageCount, pages: [], previousAnchor: null, error: error instanceof Error ? error.message : '本文を組版できませんでした。' });
      }
    }, 0);
    return () => window.clearTimeout(task);
  }, [engine, anchorKey, retryRevision, width, height, pageCount]);
  const loading = state.engine !== engine || state.anchorKey !== anchorKey || state.retryRevision !== retryRevision || state.pageCount !== pageCount;
  const page = state.pages[0] ?? null;
  const last = state.pages.at(-1);
  const isEnd = Boolean(last && last.globalEnd >= engine.index.text.length);
  return {
    page, pages: state.pages, loading, error: state.error,
    nextAnchor: last && !isEnd ? last.end : null,
    previousAnchor: state.previousAnchor,
    progress: page && engine.index.text.length ? page.globalStart / engine.index.text.length : 0,
    isEnd, retry,
  };
}
