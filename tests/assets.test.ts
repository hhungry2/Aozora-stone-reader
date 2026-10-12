import { describe, expect, it } from "vitest";
import { readerImageUrl } from "../src/lib/assets";

describe("reader image URLs", () => {
  it("keeps bundled Aozora assets under the configured base", () => {
    expect(readerImageUrl("data/images/gaiji.png")).toBe(
      `${import.meta.env.BASE_URL}data/images/gaiji.png`,
    );
    expect(readerImageUrl("/data/images/gaiji.png")).toBe(
      `${import.meta.env.BASE_URL}data/images/gaiji.png`,
    );
  });
  it("retains public HTTPS illustration URLs instead of prefixing the app base", () => {
    expect(readerImageUrl("https://example.com/figure.png")).toBe(
      "https://example.com/figure.png",
    );
  });
  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml,test",
    "http://example.com/image.jpg",
    "//example.com/image.jpg",
    "https://user:password@example.com/image.jpg",
    "https://%",
  ])("rejects unsafe or malformed URL %s", (url) => {
    expect(readerImageUrl(url)).toBe("");
  });
});
