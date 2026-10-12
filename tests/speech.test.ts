import { describe, expect, it } from "vitest";
import { createSpeechSource, nextSpeechChunk } from "../src/reader/speech";
import type { Anchor, TextBlock } from "../src/types";

const block = (
  id: string,
  text: string,
  extra: Partial<TextBlock> = {},
): TextBlock => ({
  id,
  text,
  kind: "paragraph",
  rubies: [],
  emphasis: [],
  inlineImages: [],
  indent: 0,
  ...extra,
});
const at = (blockId: string, offset = 0): Anchor => ({
  blockId,
  offset,
  context: "",
});

function read(blocks: TextBlock[], from = at(blocks[0]?.id ?? "")) {
  const source = createSpeechSource({ blocks });
  const chunks = [];
  let cursor = from;
  for (let i = 0; i < 1000; i++) {
    const chunk = nextSpeechChunk(source, cursor);
    if (!chunk) return chunks;
    chunks.push(chunk);
    cursor = chunk.next;
  }
  throw new Error("Speech cursor did not reach the end");
}

describe("speech source", () => {
  it("uses ruby once, including when the visible page starts inside the parent word", () => {
    const blocks = [
      block("a", "御釈迦様は歩いた。次の文。", {
        rubies: [{ start: 0, end: 4, reading: "おしゃかさま" }],
      }),
    ];
    const chunks = read(blocks, at("a", 2));
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "おしゃかさまは歩いた。",
      "次の文。",
    ]);
    expect(chunks[0].start).toMatchObject({ blockId: "a", offset: 0 });
    expect(chunks[0].excerpt).toBe("御釈迦様は歩いた。");
    expect(chunks[0].range).toEqual({
      blockId: "a",
      start: 0,
      end: 9,
      globalStart: 0,
      globalEnd: 9,
    });
    expect(chunks[1].range).toEqual({
      blockId: "a",
      start: 9,
      end: 13,
      globalStart: 9,
      globalEnd: 13,
    });
  });

  it("starts at the source anchor and continues over headings, empty blocks and notes", () => {
    const blocks = [
      block("a", "読み飛ばす文。ここから。"),
      block("blank", "　\n"),
      block("h", "次の章", { kind: "heading" }),
      block("b", "本文！「次？」終わり。"),
      block("note", "注記", { kind: "note" }),
    ];
    expect(read(blocks, at("a", 7)).map((chunk) => chunk.text)).toEqual([
      "ここから。",
      "次の章",
      "本文！",
      "「次？」",
      "終わり。",
      "注記",
    ]);
    expect(read(blocks, at("note", 2))).toEqual([]);
    expect(read([])).toEqual([]);
  });

  it("uses image alternatives and excludes object replacement characters", () => {
    const image = { src: "gaiji.png", sourceUrl: "", alt: "外字" };
    const chunks = read([
      block("a", "文字\ufffcです。", {
        inlineImages: [{ ...image, start: 2, end: 3 }],
      }),
      block("img", "", { kind: "image", image: { ...image, alt: "山の挿絵" } }),
      block("empty", "", { kind: "image" }),
      block("last", "終わり。"),
    ]);
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "文字外字です。",
      "山の挿絵",
      "終わり。",
    ]);
    expect(chunks.at(-1)?.position).toBe(11);
    expect(chunks[0].range).toMatchObject({ blockId: "a", start: 0, end: 6 });
    expect(chunks[1].range).toEqual({
      blockId: "img",
      start: 0,
      end: 1,
      globalStart: 7,
      globalEnd: 8,
    });
    expect(chunks.at(-1)?.range).toEqual({
      blockId: "last",
      start: 0,
      end: 4,
      globalStart: 11,
      globalEnd: 15,
    });
  });

  it("splits long passages without losing text, splitting surrogate pairs or cutting ruby", () => {
    const text = `${"あ".repeat(119)}𠮷野${"続き".repeat(160)}。`;
    const blocks = [
      block("a", text, {
        rubies: [{ start: 119, end: 122, reading: "よしの" }],
      }),
    ];
    const chunks = read(blocks);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(
      `${"あ".repeat(119)}よしの${"続き".repeat(160)}。`,
    );
    expect(
      chunks.every(
        (chunk) => chunk.start.offset !== 120 && chunk.start.offset !== 121,
      ),
    ).toBe(true);
    expect(chunks.map((chunk) => chunk.excerpt).join("")).toBe(text);
  });

  it("consumes all-whitespace text and an image at the end without looping", () => {
    expect(read([block("blank", " ".repeat(400))])).toEqual([]);
    expect(
      read([
        block("img", "", {
          kind: "image",
          image: { src: "", sourceUrl: "", alt: "図" },
        }),
      ]).map((chunk) => chunk.text),
    ).toEqual(["図"]);
  });

  it("keeps combining and emoji sequences intact, including one longer than a chunk", () => {
    const text = `${"あ".repeat(119)}か\u3099👨‍👩‍👧‍👦${"い".repeat(125)}${"a" + "\u0301".repeat(130)}。`;
    const chunks = read([block("a", text)]);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    expect(chunks.some((chunk) => chunk.text.includes("か\u3099👨‍👩‍👧‍👦"))).toBe(
      true,
    );
    expect(
      chunks.some((chunk) => chunk.text.includes("a" + "\u0301".repeat(130))),
    ).toBe(true);
  });
});
