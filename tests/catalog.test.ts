import { describe, expect, it } from 'vitest';
import { createCatalogIndex, filterCatalog } from '../src/lib/catalog';
import type { CatalogEntry } from '../src/types';

function entry(id: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id, title: '吾輩は猫である', titleKana: 'ワガハイハネコデアル', subtitle: '',
    authorLabel: '夏目 漱石', authors: [{ id: '1', name: '夏目 漱石', kana: 'なつめ そうせき', role: '著者' }],
    cardUrl: '', dataPath: '', contentVersion: 'v1', characterCount: 100, excerpt: '', features: [],
    ...overrides,
  };
}

describe('catalog metadata search', () => {
  it.each(['夏目漱石', '夏目 漱石', '夏目　漱石', 'なつめそうせき', 'なつめ そうせき', 'ﾅﾂﾒ ｿｳｾｷ'])(
    'matches spaced author metadata with query %s', (query) => {
      const work = entry('1');
      expect(filterCatalog([work], query)).toEqual([work]);
      expect(work.authors[0].name).toBe('夏目 漱石');
      expect(work.authors[0].kana).toBe('なつめ そうせき');
    },
  );

  it('matches spaced queries against names without spaces and keeps multiword AND search', () => {
    const work = entry('1', {
      authorLabel: '夏目漱石', authors: [{ id: '1', name: '夏目漱石', kana: 'なつめそうせき', role: '著者' }],
    });
    expect(filterCatalog([work], '猫 なつめ そうせき')).toEqual([work]);
    expect(filterCatalog([work], '猫 なつめ 存在しない')).toEqual([]);
  });

  it('normalizes each title, subtitle and translator field while keeping words independent', () => {
    const work = entry('2', {
      title: 'The Happy Prince', titleKana: 'ハッピー プリンス', subtitle: 'ある 童話',
      authorLabel: 'ワイルド', authors: [
        { id: '2', name: 'ワイルド', kana: 'わいるど', role: '著者' },
        { id: '3', name: '結城 浩', kana: 'ゆうき ひろし', role: '翻訳者' },
      ],
    });
    expect(filterCatalog([work], 'ＴＨＥＨＡＰＰＹＰＲＩＮＣＥ 結城浩')).toEqual([work]);
    expect(filterCatalog([work], 'ﾊｯﾋﾟｰﾌﾟﾘﾝｽ ある童話 ゆうきひろし')).toEqual([work]);
  });

  it('does not join separate metadata fields or people into a false match', () => {
    const work = entry('1', {
      title: '猫', titleKana: 'ねこ', subtitle: '童話', authorLabel: '夏目 漱石・結城 浩',
      authors: [
        { id: '1', name: '夏目 漱石', kana: 'なつめ そうせき', role: '著者' },
        { id: '2', name: '結城 浩', kana: 'ゆうき ひろし', role: '翻訳者' },
      ],
    });
    for (const query of ['猫ねこ', '童話夏目', 'そうせき結城', 'なつめそうせきゆうきひろし']) {
      expect(filterCatalog([work], query)).toEqual([]);
    }
    expect(filterCatalog([work], '猫 童話 夏目')).toEqual([work]);
  });

  it('returns every entry for whitespace-only input without mutating source order', () => {
    const catalog = [entry('2', { titleKana: 'わ' }), entry('1', { titleKana: 'あ' })];
    expect(filterCatalog(catalog, '　\n\t ').map((work) => work.id)).toEqual(['1', '2']);
    expect(catalog.map((work) => work.id)).toEqual(['2', '1']);
  });
});

describe('catalog sort order', () => {
  it('places readable classics first without losing or duplicating the rest of the catalog', () => {
    const catalog = [
      entry('100001', { title: 'あ', titleKana: 'あ' }),
      entry('000301', { title: '人間失格', titleKana: 'にんげんしっかく', dataPath: 'data/books/000301.json' }),
      entry('000773', { title: 'こころ', titleKana: 'こころ', dataPath: 'data/books/000773.json' }),
      entry('000127', { title: '羅生門', titleKana: 'らしょうもん' }),
    ];
    const index = createCatalogIndex(catalog);
    expect(index.search('', 'recommended').map((work) => work.id)).toEqual(['000773', '000301', '100001', '000127']);
    expect(index.search('', 'title').map((work) => work.id)).toEqual(['100001', '000773', '000301', '000127']);
    expect(index.search('人間', 'recommended').map((work) => work.id)).toEqual(['000301']);
    expect(catalog.map((work) => work.id)).toEqual(['100001', '000301', '000773', '000127']);
  });

  it('sorts cleaned title readings while allowing both original and cleaned search queries', () => {
    const catalog = [
      entry('2', { title: '（い）', titleKana: '（い）' }),
      entry('1', { title: 'あ', titleKana: 'あ' }),
    ];
    const index = createCatalogIndex(catalog);
    expect(index.search('').map((work) => work.id)).toEqual(['1', '2']);
    expect(index.search('い')).toEqual([catalog[0]]);
    expect(index.search('（い）')).toEqual([catalog[0]]);
    expect(catalog[0].title).toBe('（い）');
  });

  it('orders an author by title before using numeric ids to break ties', () => {
    const catalog = [
      entry('1', { title: '吾輩は猫である', titleKana: 'わがはいはねこである' }),
      entry('20', { title: 'こゝろ', titleKana: 'こころ' }),
      entry('3', { title: 'こゝろ', titleKana: 'こころ' }),
    ];
    expect(filterCatalog(catalog, '', 'author').map((work) => work.id)).toEqual(['3', '20', '1']);
  });

  it('groups author readings with different spacing and sorts their titles together', () => {
    const catalog = [
      entry('1', { titleKana: 'わ', authors: [{ id: '1', name: '夏目 漱石', kana: 'ナツメ ソウセキ', role: '著者' }] }),
      entry('2', { titleKana: 'あ', authors: [{ id: '1', name: '夏目漱石', kana: 'なつめそうせき', role: '著者' }] }),
      entry('3', { authors: [{ id: '2', name: '芥川 龍之介', kana: 'あくたがわ りゅうのすけ', role: '著者' }] }),
    ];
    expect(filterCatalog(catalog, '', 'author').map((work) => work.id)).toEqual(['3', '2', '1']);
  });

  it('falls back to title and author labels when readings are absent', () => {
    const catalog = [
      entry('2', { title: 'い', titleKana: '', authorLabel: 'い', authors: [] }),
      entry('1', { title: 'あ', titleKana: '', authorLabel: 'あ', authors: [] }),
    ];
    expect(filterCatalog(catalog, '', 'title').map((work) => work.id)).toEqual(['1', '2']);
    expect(filterCatalog(catalog, '', 'author').map((work) => work.id)).toEqual(['1', '2']);
  });
});
