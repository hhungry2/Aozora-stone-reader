import type { CatalogEntry } from "../types";

/** Search normalization is deliberately confined to metadata, never book text. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60),
    )
    .replace(/\s+/g, " ")
    .trim();
}

export type CatalogSort = "title" | "author";
const collator = new Intl.Collator("ja", {
  sensitivity: "base",
  numeric: true,
});
const compactSearch = (text: string) => normalizeSearch(text).replace(/ /g, "");
export const CATALOG_PAGE_SIZE = 40;

interface SearchFields {
  fields: string[];
  title: string;
  author: string;
}
const searchCache = new WeakMap<CatalogEntry, SearchFields>();
function indexed(entry: CatalogEntry): SearchFields {
  let value = searchCache.get(entry);
  if (!value) {
    value = {
      fields: [
        entry.title,
        entry.titleKana,
        entry.subtitle,
        entry.authorLabel,
        ...entry.authors.flatMap((person) => [person.name, person.kana]),
      ].map(compactSearch),
      title: normalizeSearch(entry.titleKana || entry.title),
      author: compactSearch(entry.authors[0]?.kana || entry.authorLabel),
    };
    searchCache.set(entry, value);
  }
  return value;
}

/** Prepare metadata and both sort orders once for a loaded catalog. */
export function createCatalogIndex(catalog: readonly CatalogEntry[]) {
  catalog.forEach(indexed);
  const compare = (a: CatalogEntry, b: CatalogEntry) =>
    collator.compare(indexed(a).title, indexed(b).title) ||
    a.id.localeCompare(b.id, "en", { numeric: true });
  const orders = {
    title: [...catalog].sort(compare),
    author: [...catalog].sort(
      (a, b) =>
        collator.compare(indexed(a).author, indexed(b).author) || compare(a, b),
    ),
  };
  return {
    search(query: string, sort: CatalogSort = "title") {
      const words = normalizeSearch(query).split(" ").filter(Boolean);
      return words.length
        ? orders[sort].filter((entry) =>
            words.every((word) =>
              indexed(entry).fields.some((field) => field.includes(word)),
            ),
          )
        : orders[sort];
    },
  };
}

export function filterCatalog(
  catalog: readonly CatalogEntry[],
  query: string,
  sort: CatalogSort = "title",
): CatalogEntry[] {
  return createCatalogIndex(catalog).search(query, sort);
}
