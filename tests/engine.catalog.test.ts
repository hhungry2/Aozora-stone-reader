import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FixedMeasurer } from "@non-standardworld/stone-engine.js";
import { indexBook, PaginationEngine } from "../src/reader/engine";
import { defaultSettings, type Book, type CatalogEntry } from "../src/types";

const catalog = JSON.parse(
  readFileSync("public/data/catalog.json", "utf8"),
) as CatalogEntry[];
const books = readdirSync("public/data/books")
  .filter((file) => file.endsWith(".json"))
  .map(
    (file) =>
      JSON.parse(readFileSync(`public/data/books/${file}`, "utf8")) as Book,
  );

describe("selected Aozora catalog with Stone", () => {
  it("ships exactly one complete text for every catalog entry", () => {
    expect(new Set(catalog.map((entry) => entry.id)).size).toBe(catalog.length);
    expect(books.map((book) => book.id).sort()).toEqual(
      catalog.map((entry) => entry.id).sort(),
    );
    for (const entry of catalog) {
      expect(books.find((book) => book.id === entry.id)).toMatchObject(entry);
    }
  });

  for (const direction of ["tbRl", "lrTb"] as const) {
    // Budget each complete work separately so growing the shelf does not exhaust
    // one shared timeout. Every page of every catalog entry is still checked.
    it.each(books)(
      `preserves the complete source of $title in ${direction}`,
      (book) => {
        const engine = new PaginationEngine(
          book,
          { ...defaultSettings, direction },
          640,
          480,
          new FixedMeasurer(),
        );
        const index = engine.index;
        let at = 0;
        const pieces: string[] = [];
        let pages = 0;
        while (at < index.text.length) {
          const page = engine.pageAtPosition(at);
          expect(page.globalStart, book.title).toBe(at);
          expect(page.globalEnd, book.title).toBeGreaterThan(at);
          expect(
            page.context.runs.every((run) => run.visibility === "visible"),
            book.title,
          ).toBe(true);
          pieces.push(page.text);
          at = page.globalEnd;
          expect(++pages, book.title).toBeLessThan(10000);
        }
        expect(pieces.join(""), book.title).toBe(indexBook(book).text);
        expect(engine.cacheSize).toBeLessThanOrEqual(3);
      },
      120000,
    );

    it(`lays out initial, middle, and ending anchors at 36px in 320px ${direction}`, () => {
      for (const book of books) {
        const engine = new PaginationEngine(
          book,
          { ...defaultSettings, direction, fontSize: 36 },
          288,
          360,
          new FixedMeasurer(),
        );
        for (const offset of [
          0,
          Math.floor(engine.index.text.length / 2),
          Math.max(0, engine.index.text.length - 80),
        ]) {
          const page = engine.pageAtPosition(offset);
          expect(page.globalStart, book.title).toBeLessThanOrEqual(offset);
          expect(page.globalEnd, book.title).toBeGreaterThan(offset);
          expect(
            page.glyphs.every(
              (glyph) => Number.isFinite(glyph.x) && Number.isFinite(glyph.y),
            ),
          ).toBe(true);
          for (const range of page.ranges)
            for (const ruby of range.block.rubies) {
              const start = range.start + ruby.start;
              const end = range.start + ruby.end;
              expect(
                page.globalEnd > start && page.globalEnd < end,
                book.title,
              ).toBe(false);
            }
        }
      }
    }, 30000);
  }
});
