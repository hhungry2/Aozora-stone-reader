import type { CatalogEntry } from "../types";
import { displayTitle } from "./titles";

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

export type CatalogSort = "recommended" | "title" | "author";
// Stable work IDs select readable editions without merging the other editions.
export const FEATURED_WORK_IDS = [
  "000773",
  "000301",
  "000127",
  "000456",
  "000752",
  "001567",
  "000624",
  "000424",
  "000789",
  "000092",
  "043754",
  "000628",
  "000637",
  "056648",
  "045245",
  "056041",
  "000360",
  "000799",
  "000069",
  "000179",
  "043015",
  "043016",
  "000042",
  "000270",
  "000277",
  "000470",
  "043752",
  "000473",
  "000753",
  "043017",
  "000055",
  "000621",
  "001737",
  "000427",
  "054372",
  "056645",
  "042618",
  "002381",
  "000652",
  "055908",
  "000211",
  "000496",
] as const;
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
      title: normalizeSearch(displayTitle(entry.titleKana || entry.title)),
      author: compactSearch(entry.authors[0]?.kana || entry.authorLabel),
    };
    searchCache.set(entry, value);
  }
  return value;
}

/** Prepare search metadata and sort orders once for a loaded catalog. */
export function createCatalogIndex(catalog: readonly CatalogEntry[]) {
  catalog.forEach(indexed);
  const compare = (a: CatalogEntry, b: CatalogEntry) =>
    collator.compare(indexed(a).title, indexed(b).title) ||
    a.id.localeCompare(b.id, "en", { numeric: true });
  const orders = {
    recommended: [] as CatalogEntry[],
    title: [...catalog].sort(compare),
    author: [...catalog].sort(
      (a, b) =>
        collator.compare(indexed(a).author, indexed(b).author) || compare(a, b),
    ),
  };
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const featured = FEATURED_WORK_IDS.flatMap((id) => {
    const entry = byId.get(id);
    return entry?.dataPath ? [entry] : [];
  });
  const featuredIds = new Set(featured.map((entry) => entry.id));
  orders.recommended = [
    ...featured,
    ...orders.title.filter((entry) => !featuredIds.has(entry.id)),
  ];
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
