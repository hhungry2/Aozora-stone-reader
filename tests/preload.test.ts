import { describe, expect, it, vi } from "vitest";
import { PaginationEngine } from "../src/reader/engine";
import { preloadPages, type PreloadProgress } from "../src/reader/preload";
import { defaultSettings, type Book, type ReaderSettings } from "../src/types";

const book: Book = {
  id: "preload",
  title: "先読みの試験",
  titleKana: "",
  subtitle: "",
  authors: [],
  authorLabel: "著者",
  cardUrl: "",
  dataPath: "",
  contentVersion: "1",
  characterCount: 0,
  excerpt: "",
  features: [],
  schemaVersion: 1,
  toc: [],
  credits: "",
  source: { url: "", fetchedAt: "", sha256: "", encoding: "UTF-8" },
  conversion: { version: "", warnings: [] },
  blocks: [
    {
      id: "p0",
      kind: "paragraph",
      text: "　「組版。」12月の𠮷野。\n".repeat(300),
      rubies: [{ start: 2, end: 4, reading: "くみはん" }],
      emphasis: [],
      inlineImages: [],
      indent: 0,
    },
  ],
};

function scheduler() {
  const tasks: { run: () => void; cancelled: boolean }[] = [];
  return {
    schedule(run: () => void) {
      const task = { run, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    step() {
      const task = tasks.shift();
      if (task && !task.cancelled) task.run();
    },
    drain() {
      let remaining = 1000;
      while (tasks.length && remaining-- > 0) this.step();
      expect(tasks).toHaveLength(0);
    },
  };
}

for (const direction of ["tbRl", "lrTb"] as const) {
  describe(`background page preparation ${direction}`, () => {
    const engineFor = (paginationMode: ReaderSettings["paginationMode"]) =>
      new PaginationEngine(
        book,
        { ...defaultSettings, direction, paginationMode },
        320,
        370,
      );

    it("keeps the original one-page lookahead and three-page cache", () => {
      const engine = engineFor("on-demand");
      const first = engine.pageAtPosition(0);
      const clock = scheduler();
      const progress: PreloadProgress[] = [];
      const prepare = vi.spyOn(engine, "preloadPage");
      preloadPages(
        engine,
        first.globalEnd,
        "on-demand",
        (value) => progress.push(value),
        clock.schedule,
      );
      expect(prepare).not.toHaveBeenCalled();
      clock.drain();
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(progress.at(-1)).toMatchObject({
        state: "complete",
        preparedPages: 1,
      });
      let page = first;
      for (let i = 0; i < 20; i++) page = engine.pageAt(page.end);
      expect(engine.cacheSize).toBeLessThanOrEqual(3);
    });

    it("retains ten future pages and replenishes them with a bounded cache", () => {
      const engine = engineFor("batch");
      let page = engine.pageAtPosition(0);
      const clock = scheduler();
      let progress: PreloadProgress | undefined;
      for (let i = 0; i < 15; i++) {
        const current = page;
        preloadPages(
          engine,
          page.globalEnd,
          "batch",
          (value) => {
            progress = value;
          },
          clock.schedule,
        );
        clock.drain();
        expect(progress).toMatchObject({
          state: "complete",
          preparedPages: 10,
        });
        expect(engine.pageAt(current.start)).toBe(current);
        const next = engine.pageAt(current.end);
        expect(engine.previousAnchor(next)).toEqual(current.start);
        expect(engine.cacheSize).toBeLessThanOrEqual(14);
        page = next;
      }
      expect(engine.cacheSize).toBeGreaterThan(10);
    });

    it("prepares the entire source, retains the first page and keeps navigation anchors intact", () => {
      const engine = engineFor("all");
      const first = engine.pageAtPosition(0);
      const restored = engine.pageAtPosition(1234);
      const next = engine.pageAt(restored.end);
      const clock = scheduler();
      let progress: PreloadProgress | undefined;
      preloadPages(
        engine,
        next.globalEnd,
        "all",
        (value) => {
          progress = value;
        },
        clock.schedule,
      );
      clock.drain();
      expect(progress).toMatchObject({
        state: "complete",
        progress: 1,
        error: null,
      });
      expect(engine.previousAnchor(next)).toEqual(restored.start);
      expect(engine.pageAtPosition(0)).toBe(first);
      expect(engine.cacheSize).toBeGreaterThan(14);
      let position = 0;
      let text = "";
      let count = 0;
      while (position < engine.index.text.length) {
        const page = engine.pageAtPosition(position);
        expect(page.globalStart).toBe(position);
        expect(page.globalEnd).toBeGreaterThan(position);
        text += page.text;
        position = page.globalEnd;
        count += 1;
      }
      expect(text).toBe(engine.index.text);
      expect(progress!.preparedPages).toBe(count);
    });

    it("cancels pending work and resumes full-book preparation after changing pages", () => {
      const engine = engineFor("all");
      const first = engine.pageAtPosition(0);
      const clock = scheduler();
      const progress: PreloadProgress[] = [];
      const cancel = preloadPages(
        engine,
        first.globalEnd,
        "all",
        (value) => progress.push(value),
        clock.schedule,
      );
      for (let i = 0; i < 15; i++) clock.step();
      const position = engine.preparedBookPosition;
      expect(position).toBeGreaterThan(0);
      expect(position).toBeLessThan(engine.index.text.length);
      cancel();
      const reports = progress.length;
      clock.drain();
      expect(progress).toHaveLength(reports);
      expect(engine.preparedBookPosition).toBe(position);
      const restored = engine.pageAtPosition(2345);
      preloadPages(
        engine,
        restored.globalEnd,
        "all",
        (value) => progress.push(value),
        clock.schedule,
      );
      expect(progress.at(-1)!.progress).toBeGreaterThan(0);
      clock.drain();
      expect(progress.at(-1)).toMatchObject({ state: "complete", progress: 1 });
      expect(progress.map((value) => value.progress)).toEqual(
        progress.map((value) => value.progress).sort((a, b) => a - b),
      );
    });

    it("stops at the end and allows retry after a background error without losing the displayed page", () => {
      const engine = engineFor("batch");
      const last = engine.pageAtPosition(engine.index.text.length - 4);
      const clock = scheduler();
      let progress: PreloadProgress | undefined;
      preloadPages(
        engine,
        last.globalEnd,
        "batch",
        (value) => {
          progress = value;
        },
        clock.schedule,
      );
      clock.drain();
      expect(progress).toMatchObject({ state: "complete", preparedPages: 0 });
      preloadPages(
        engine,
        engine.index.text.length - 4,
        "batch",
        (value) => {
          progress = value;
        },
        clock.schedule,
      );
      clock.drain();
      expect(progress).toMatchObject({ state: "complete", preparedPages: 1 });
      const first = engine.pageAtPosition(0);
      vi.spyOn(engine, "preloadPage").mockImplementationOnce(() => {
        throw new Error("試験用の先読みエラー");
      });
      preloadPages(
        engine,
        first.globalEnd,
        "batch",
        (value) => {
          progress = value;
        },
        clock.schedule,
      );
      clock.drain();
      expect(progress).toMatchObject({
        state: "error",
        error: "試験用の先読みエラー",
      });
      expect(engine.pageAt(first.start)).toBe(first);
      preloadPages(
        engine,
        first.globalEnd,
        "batch",
        (value) => {
          progress = value;
        },
        clock.schedule,
      );
      clock.drain();
      expect(progress).toMatchObject({
        state: "complete",
        preparedPages: 10,
        error: null,
      });
    });
  });
}
