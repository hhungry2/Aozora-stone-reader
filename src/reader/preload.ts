import type { ReaderSettings } from "../types";
import type { PaginationEngine } from "./engine";

export interface PreloadProgress {
  mode: ReaderSettings["paginationMode"];
  state: "running" | "complete" | "error";
  preparedPages: number;
  progress: number;
  error: string | null;
}

type Schedule = (task: () => void) => () => void;

/** Yield between pages so input and painting can run throughout a long book. */
const scheduleIdle: Schedule = (task) => {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(task, { timeout: 100 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, 16);
  return () => window.clearTimeout(id);
};

export function preloadPages(
  engine: PaginationEngine,
  start: number,
  mode: ReaderSettings["paginationMode"],
  onProgress: (progress: PreloadProgress) => void,
  schedule: Schedule = scheduleIdle,
): () => void {
  let cancelled = false;
  let cancelTask = () => {};
  let position = start;
  let ahead = 0;
  const target = mode === "on-demand" ? 1 : 10;
  const length = engine.index.text.length;
  const done = () =>
    (ahead >= target || position >= length) &&
    (mode !== "all" || engine.preparedBookPosition >= length);
  const report = (error: string | null = null) =>
    onProgress({
      mode,
      state: error ? "error" : done() ? "complete" : "running",
      preparedPages: mode === "all" ? engine.preparedBookPages : ahead,
      progress:
        mode === "all"
          ? length
            ? engine.preparedBookPosition / length
            : 1
          : done()
            ? 1
            : ahead / target,
      error,
    });
  const step = () => {
    if (cancelled) return;
    try {
      // Keep the next ten pages ready even when resuming far into a long book.
      if (ahead < target && position < length) {
        position = engine.preloadPage(position).globalEnd;
        ahead += 1;
      } else if (mode === "all") {
        engine.preloadNextBookPage();
      }
      report();
      if (!done()) cancelTask = schedule(step);
    } catch (error) {
      report(
        error instanceof Error ? error.message : "先読みできませんでした。",
      );
    }
  };
  report();
  if (!done()) cancelTask = schedule(step);
  return () => {
    cancelled = true;
    cancelTask();
  };
}
