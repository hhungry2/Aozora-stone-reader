import type { CatalogEntry } from '../types';

/** Search normalization is deliberately confined to metadata, never book text. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('ja-JP')
    .replace(/[\u30a1-\u30f6]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/\s+/g, ' ').trim();
}

export type CatalogSort = 'title' | 'author';
const collator = new Intl.Collator('ja', { sensitivity: 'base', numeric: true });

export function filterCatalog(catalog: readonly CatalogEntry[], query: string, sort: CatalogSort = 'title'): CatalogEntry[] {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  const filtered = catalog.filter((entry) => {
    const text = normalizeSearch([entry.title, entry.titleKana, entry.subtitle, entry.authorLabel,
      ...entry.authors.flatMap((person) => [person.name, person.kana])].join(' '));
    return words.every((word) => text.includes(word));
  });
  const title = (entry: CatalogEntry) => normalizeSearch(entry.titleKana || entry.title);
  const author = (entry: CatalogEntry) => normalizeSearch(entry.authors[0]?.kana || entry.authorLabel);
  return filtered.sort((a, b) => {
    const comparison = sort === 'author' ? collator.compare(author(a), author(b)) : collator.compare(title(a), title(b));
    return comparison || a.id.localeCompare(b.id, 'en', { numeric: true });
  });
}
