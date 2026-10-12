import { describe, expect, it } from "vitest";
import { normalizeWebNovelUrl, webNovelId } from "../src/lib/web-novel";

describe("web novel URL boundary", () => {
  it.each([
    [
      " https://NCODE.SYOSETU.COM/N1234AB ",
      "https://ncode.syosetu.com/n1234ab/",
    ],
    [
      "https://ncode.syosetu.com/n1234ab/0002/?tracking=1#L1",
      "https://ncode.syosetu.com/n1234ab/2/",
    ],
    [
      "https://ncode.syosetu.com/n1234ab/?p=0003&utm_source=discard#main",
      "https://ncode.syosetu.com/n1234ab/?p=3",
    ],
    [
      "https://ncode.syosetu.com/n1234ab/2/?p=not-an-index",
      "https://ncode.syosetu.com/n1234ab/2/",
    ],
    ["https://kakuyomu.jp/works/00100/", "https://kakuyomu.jp/works/00100"],
    [
      "https://kakuyomu.jp/works/00100/episodes/00200/?p=2#p1",
      "https://kakuyomu.jp/works/00100/episodes/00200",
    ],
  ])("canonicalizes %s", (source, expected) => {
    expect(normalizeWebNovelUrl(source)).toBe(expected);
    expect(normalizeWebNovelUrl(expected)).toBe(expected);
  });

  it.each([
    "",
    "n1234ab",
    "http://ncode.syosetu.com/n1234ab/",
    "https://syosetu.com/",
    "https://novel18.syosetu.com/n1234ab/",
    "https://ncode.syosetu.com.attacker.example/n1234ab/",
    "https://attacker.example/?url=https://kakuyomu.jp/works/100",
    "https://user@kakuyomu.jp/works/100",
    "https://user:secret@kakuyomu.jp/works/100",
    "https://kakuyomu.jp:443/works/100",
    "https://kakuyomu.jp:8443/works/100",
    "https://kakuyomu.jp/",
    "https://kakuyomu.jp/users/100",
    "https://kakuyomu.jp/works/abc",
    "https://kakuyomu.jp/works/100/episodes/abc",
    "https://ncode.syosetu.com/n1234ab/0/",
    "https://ncode.syosetu.com/n1234ab/000/",
    "https://ncode.syosetu.com/n1234ab/1/extra/",
    "https://ncode.syosetu.com/n1234ab/?p=0",
    "https://ncode.syosetu.com/n1234ab/?p=-1",
    "https://ncode.syosetu.com/n1234ab/?p=1.5",
    "https://ncode.syosetu.com/n1234ab/?p=1e3",
    "https://ncode.syosetu.com/n1234ab/?p=",
    "https://ncode.syosetu.com/n1234ab/?p=1&p=2",
    "https://kaku\nyomu.jp/works/100",
    "https://kakuyomu.jp/works/100\\episodes\\200",
    "javascript:alert(1)",
    "file:///works/100",
    "data:text/html,body",
  ])("rejects an unsupported or ambiguous address: %s", (source) => {
    expect(() => normalizeWebNovelUrl(source)).toThrow();
  });

  it("keeps IDs stable across tracking, fragments and canonical spelling", () => {
    expect(
      webNovelId("https://ncode.syosetu.com/N1234AB/0002/?track=1#main"),
    ).toBe("web-narou-n1234ab-2");
    expect(webNovelId("https://ncode.syosetu.com/n1234ab/2/")).toBe(
      "web-narou-n1234ab-2",
    );
    expect(webNovelId("https://ncode.syosetu.com/n1234ab/?p=02")).toBe(
      "web-narou-n1234ab-index-2",
    );
    expect(
      webNovelId("https://kakuyomu.jp/works/00100/episodes/00200/?tracking=1"),
    ).toBe("web-kakuyomu-00100-00200");
  });
});
