import { describe, expect, it } from "vitest";
import type { ReaderPageData } from "../src/reader/engine";
import {
  ScrollExtentIndex,
  sourceFrame,
  visibleSourceRange,
} from "../src/reader/scrollGeometry";

describe("scroll extent lookup", () => {
  it("keeps physical positions consistent after distant estimates are measured", () => {
    const sizes = Array.from(
      { length: 10000 },
      (_, index) => 50 + (index % 27),
    );
    const extents = new ScrollExtentIndex(sizes);
    for (const index of [0, 31, 4095, 9000, 9999]) {
      const measured = sizes[index] * 1.75;
      expect(extents.update(index, measured)).toBe(measured - sizes[index]);
      sizes[index] = measured;
    }
    expect(extents.total).toBe(sizes.reduce((sum, size) => sum + size, 0));
    for (const index of [0, 31, 4095, 9000, 9999]) {
      const before = sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
      expect(extents.prefix(index)).toBe(before);
      expect(extents.find(before)).toBe(index);
      expect(extents.find(before + sizes[index] - 0.25)).toBe(index);
    }
    expect(extents.find(-100)).toBe(0);
    expect(extents.find(extents.total + 100)).toBe(9999);
  });

  it("handles empty works and prevents zero-size placeholders", () => {
    const empty = new ScrollExtentIndex([]);
    expect(empty.total).toBe(0);
    expect(empty.find(100)).toBe(0);
    const extents = new ScrollExtentIndex([0, 20, -4]);
    expect(extents.total).toBe(22);
    expect(extents.find(1)).toBe(1);
    extents.update(1, 0);
    expect(extents.total).toBe(3);
  });
});

function page(vertical: boolean): ReaderPageData {
  return {
    globalStart: 100,
    globalEnd: 106,
    insetX: 8,
    insetY: 12,
    width: 120,
    height: 140,
    images: [],
    context: {
      direction: vertical ? "tbRl" : "lrTb",
      runs: [
        { char: "あ", frame: { x: 92, y: 0, width: 20, height: 20 } },
        { char: "𠮷", frame: { x: 92, y: 20, width: 20, height: 20 } },
        {
          char: "\n",
          isNewline: true,
          frame: { x: 92, y: 40, width: 0, height: 20 },
        },
        { char: "い", frame: { x: 52, y: 40, width: 20, height: 20 } },
        { char: "う", frame: { x: 52, y: 60, width: 20, height: 20 } },
      ],
    },
  } as ReaderPageData;
}

describe("visible source positions", () => {
  it("maps right-to-left columns and original UTF-16 offsets without DOM geometry", () => {
    const chunk = page(true);
    expect(sourceFrame(chunk, 102)).toEqual({ offset: 0, extent: 20 });
    expect(sourceFrame(chunk, 104)).toEqual({ offset: 40, extent: 20 });
    expect(visibleSourceRange(chunk, 0, 20)).toEqual({ start: 100, end: 103 });
    expect(visibleSourceRange(chunk, 20, 60)).toEqual({ start: 104, end: 106 });
    expect(visibleSourceRange(chunk, 60, 100)).toBeNull();
  });

  it("includes partially visible horizontal glyphs and excludes explicit newline anchors", () => {
    const chunk = page(false);
    expect(sourceFrame(chunk, 104)).toEqual({ offset: 52, extent: 20 });
    expect(visibleSourceRange(chunk, 33, 72)).toEqual({ start: 101, end: 105 });
    expect(visibleSourceRange(chunk, 92, 130)).toBeNull();
  });

  it("exposes source positions for image-only chunks", () => {
    const chunk = page(false);
    chunk.context.runs = [];
    chunk.images = [
      { src: "image.png", alt: "図版", x: 0, y: 0, width: 80, height: 80 },
    ];
    expect(visibleSourceRange(chunk, 20, 60)).toEqual({ start: 100, end: 106 });
    expect(visibleSourceRange(chunk, 140, 200)).toBeNull();
    expect(sourceFrame(chunk, 100)).toBeNull();
  });

  it("keeps empty vertical chunks bounded by their progression width", () => {
    const chunk = page(true);
    chunk.context.runs = [];
    expect(visibleSourceRange(chunk, 20, 60)).toEqual({ start: 100, end: 106 });
    expect(visibleSourceRange(chunk, 125, 135)).toBeNull();
  });

  it("retains a source anchor while only blank newline rows are visible", () => {
    const chunk = page(false);
    chunk.context.runs = chunk.context.runs.filter((run) => run.isNewline);
    expect(visibleSourceRange(chunk, 52, 72)).toEqual({ start: 100, end: 101 });
    expect(visibleSourceRange(chunk, 72, 100)).toBeNull();
  });
});
