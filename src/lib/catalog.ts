import type { CatalogEntry } from '../types';

/** Search normalization is deliberately confined to metadata, never book text. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('ja-JP')
    .replace(/[\u30a1-\u30f6]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/\s+/g, ' ').trim();
}

export type CatalogSort = 'title' | 'author';
const collator = new Intl.Collator('ja', { sensitivity: 'base', numeric: true });
const compactSearch = (text: string) => normalizeSearch(text).replace(/ /g, '');

export function filterCatalog(catalog: readonly CatalogEntry[], query: string, sort: CatalogSort = 'title'): CatalogEntry[] {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  const filtered = catalog.filter((entry) => {
    // Remove spacing inside each field so a person's full name works with or without spaces.
    // Keep fields separate: a query must never match across a title/author boundary.
    const fields = [entry.title, entry.titleKana, entry.subtitle, entry.authorLabel,
      ...entry.authors.flatMap((person) => [person.name, person.kana])].map(compactSearch);
    return words.every((word) => fields.some((field) => field.includes(word)));
  });
  const title = (entry: CatalogEntry) => normalizeSearch(entry.titleKana || entry.title);
  const author = (entry: CatalogEntry) => compactSearch(entry.authors[0]?.kana || entry.authorLabel);
  return filtered.sort((a, b) => {
    const authorComparison = sort === 'author' ? collator.compare(author(a), author(b)) : 0;
    return authorComparison || collator.compare(title(a), title(b)) || a.id.localeCompare(b.id, 'en', { numeric: true });
  });
}
