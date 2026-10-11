import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FixedMeasurer } from "@non-standardworld/stone-engine.js";
import { indexBook, PaginationEngine } from "../src/reader/engine";
import { defaultSettings, type Book, type CatalogEntry } from "../src/types";

const catalog = JSON.parse(
  readFileSync("public/data/catalog.json", "utf8"),
) as CatalogEntry[];
const readable = catalog.filter((entry) => entry.dataPath);
const readBook = (entry: CatalogEntry): Book => {
  const raw = readFileSync(`public/${entry.dataPath}`);
  return JSON.parse(
    (entry.dataPath.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"),
  ) as Book;
};
// Full source/annotation validation runs in the Python importer for every work.
// Exercise the pagination engine across the original regression shelf and a
// deterministic spread of new works without holding the entire corpus in RAM.
const books = readable
  .filter((entry) => !entry.dataPath.endsWith(".gz"))
  .map(readBook);
const samples = readable
  .filter((entry) => entry.dataPath.endsWith(".gz"))
  .filter(
    (_, index, entries) =>
      index % Math.max(1, Math.floor(entries.length / 24)) === 0,
  )
  .slice(0, 24);

describe("public-domain Aozora catalog with Stone", () => {
  it("ships a text for every readable entry and explicitly marks source-only works", () => {
    expect(new Set(catalog.map((entry) => entry.id)).size).toBe(catalog.length);
    for (const entry of catalog) {
      if (entry.dataPath)
        expect(existsSync(`public/${entry.dataPath}`), entry.id).toBe(true);
      else expect(entry.availability, entry.id).toBe("source-only");
    }
  });

  it("accounts for every eligible work and every author/translator copyright flag", () => {
    const manifest = JSON.parse(
      readFileSync("public/data/import-manifest.json", "utf8"),
    );
    if (manifest.scope !== "all-public-domain") return;
    expect(catalog.map((entry) => entry.id)).toEqual(manifest.eligibleIds);
    const records = [...manifest.works, ...manifest.unavailableWorks];
    expect(records.length).toBe(catalog.length);
    expect(new Set(records.map((record) => record.id)).size).toBe(
      catalog.length,
    );
    expect(manifest.works.map((record) => record.id).sort()).toEqual(
      readable.map((entry) => entry.id).sort(),
    );
    for (const record of records) {
      expect(record.workCopyright, record.id).toBe("なし");
      expect(record.people.length, record.id).toBeGreaterThan(0);
      expect(
        record.people.every((person) => person.copyright === "なし"),
        record.id,
      ).toBe(true);
    }
  });

  for (const direction of ["tbRl", "lrTb"] as const) {
    // Budget each original regression work separately.
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

    it.each(samples)(
      `opens compressed $id at initial, middle and ending anchors in ${direction}`,
      (entry) => {
        const book = readBook(entry);
        expect(book).toMatchObject(entry);
        const engine = new PaginationEngine(
          book,
          { ...defaultSettings, direction },
          640,
          480,
          new FixedMeasurer(),
        );
        for (const offset of [
          0,
          Math.floor(engine.index.text.length / 2),
          Math.max(0, engine.index.text.length - 80),
        ]) {
          const page = engine.pageAtPosition(offset);
          expect(page.globalStart).toBeLessThanOrEqual(offset);
          expect(page.globalEnd).toBeGreaterThan(offset);
          expect(
            page.glyphs.every(
              (glyph) => Number.isFinite(glyph.x) && Number.isFinite(glyph.y),
            ),
          ).toBe(true);
        }
      },
      30000,
    );
  }
});
