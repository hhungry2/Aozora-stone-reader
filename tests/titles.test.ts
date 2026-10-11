import { describe, expect, it } from "vitest";
import { displayTitle } from "../src/lib/titles";

describe("display titles", () => {
  it.each([
    ["（最も純粋に意地悪い奴）", "最も純粋に意地悪い奴"],
    ["〈あかい、やさしい　はなもやうが〉", "あかい、やさしい　はなもやうが"],
    ["「悪魔の足跡」", "悪魔の足跡"],
    ["『「悪魔の足跡」』", "悪魔の足跡"],
    [" （ 表題 ） ", "表題"],
    ["(表題)", "表題"],
    ["【表題】", "表題"],
    ["《表題》", "表題"],
    ["［表題］", "表題"],
    ["〔表題〕", "表題"],
  ])("displays %s as %s", (source, expected) => {
    expect(displayTitle(source)).toBe(expected);
  });

  it.each([
    "「文学」の話",
    "作品（上）",
    "「猫」と「犬」",
    "（上）（下）",
    "（未完",
    "未完）",
    "（表題〉",
    "（ ）",
    "「」",
    "こころ",
    "",
  ])("preserves partial, separate or empty brackets in %s", (title) => {
    expect(displayTitle(title)).toBe(title);
  });

  it("keeps a parenthesis inside a title when removing its enclosing pair", () => {
    expect(displayTitle("（作品（上））")).toBe("作品（上）");
  });
});
