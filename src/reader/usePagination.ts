import { FixedMeasurer, getSharedCanvasMeasurer } from '@non-standardworld/stone-engine.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Anchor, Book, ReaderSettings } from '../types';
import { PaginationEngine, type ReaderPageData } from './engine';

interface Options { book: Book; settings: ReaderSettings; width: number; height: number; anchor: Anchor | null }
interface Result {
  page: ReaderPageData | null;
  loading: boolean;
  error: string | null;
  nextAnchor: Anchor | null;
  previousAnchor: Anchor | null;
  progress: number;
  isEnd: boolean;
  retry: () => void;
}

export function usePagination({ book, settings, width, height, anchor }: Options): Result {
  const [fontRevision, setFontRevision] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const retry = useCallback(() => setRetryRevision((revision) => revision + 1), []);
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
    [book, settings.direction, settings.fontSize, settings.lineHeight, settings.font, settings.ruby, width, height, fontRevision]);
  const [state, setState] = useState<{ engine: PaginationEngine | null; anchorKey: string; retryRevision: number; page: ReaderPageData | null; previousAnchor: Anchor | null; error: string | null }>({
    engine: null, anchorKey: '', retryRevision: -1, page: null, previousAnchor: null, error: null,
  });
  const anchorKey = `${anchor?.blockId ?? ''}:${anchor?.offset ?? 0}`;
  useEffect(() => {
    if (width < 80 || height < 80) return;
    const task = window.setTimeout(() => {
      try {
        const page = engine.pageAt(anchor);
        const previousAnchor = engine.previousAnchor(page);
        setState({ engine, anchorKey, retryRevision, page, previousAnchor, error: null });
        // Cache the forward page only; the visible SVG contains one page.
        if (page.globalEnd < engine.index.text.length) {
          window.setTimeout(() => { try { engine.pageAtPosition(page.globalEnd); } catch { /* surfaced when navigated to */ } }, 0);
        }
      } catch (error) {
        setState({ engine, anchorKey, retryRevision, page: null, previousAnchor: null, error: error instanceof Error ? error.message : '本文を組版できませんでした。' });
      }
    }, 0);
    return () => window.clearTimeout(task);
  }, [engine, anchorKey, retryRevision, width, height]);
  const loading = state.engine !== engine || state.anchorKey !== anchorKey || state.retryRevision !== retryRevision;
  const page = state.page;
  const isEnd = Boolean(page && page.globalEnd >= engine.index.text.length);
  return {
    page, loading, error: state.error,
    nextAnchor: page && !isEnd ? page.end : null,
    previousAnchor: state.previousAnchor,
    progress: page && engine.index.text.length ? page.globalStart / engine.index.text.length : 0,
    isEnd, retry,
  };
}
