import { afterEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { fetchJson } from "../src/lib/data";

afterEach(() => vi.unstubAllGlobals());
describe("static book data", () => {
  it("decodes explicit gzip files and hosts that already decompressed them", async () => {
    const book = { id: "100001", text: "漢字とルビ" };
    const encoded = JSON.stringify(book);
    for (const body of [gzipSync(encoded), new TextEncoder().encode(encoded)]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
      expect(
        await fetchJson("https://example.test/data/books/100001.json.gz"),
      ).toEqual(book);
    }
  });
  it("rejects missing and corrupt data instead of opening a different book", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("missing", { status: 404 })),
    );
    await expect(
      fetchJson("https://example.test/book.json.gz"),
    ).rejects.toThrow("HTTP 404");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Uint8Array([0x1f, 0x8b, 0]))),
    );
    await expect(
      fetchJson("https://example.test/book.json.gz"),
    ).rejects.toThrow();
  });
});
