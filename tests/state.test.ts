import { describe, expect, it } from 'vitest';
import { anchorProgress, createAnchor, restoreAnchor } from '../src/lib/anchors';
import { filterCatalog, normalizeSearch } from '../src/lib/catalog';
import { APP_STORAGE_PREFIX, createReaderStorage, STORAGE_PREFIX } from '../src/lib/state';
import { defaultSettings } from '../src/types';
import type { Book, CatalogEntry, ReadingRecord, TextBlock } from '../src/types';

class MemoryStorage {
  items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}

const record = (date = '2026-10-09T10:00:00.000Z'): ReadingRecord => ({
  contentVersion: 'revision-1',
  anchor: { blockId: 'paragraph-2', offset: 12, context: 'その日の夕方' },
  updatedAt: date, progress: 0.3,
  bookmarks: [{ id: 'bookmark-1', anchor: { blockId: 'paragraph-1', offset: 0, context: 'ある日の事' },
    createdAt: date, excerpt: 'ある日の事' }],
});

describe('reader state persistence', () => {
  it('migrates, validates and persists speech preferences', () => {
    const disk = new MemoryStorage();
    const { speechRate: _rate, speechVoiceURI: _voice, ...earlier } = defaultSettings;
    disk.setItem(`${STORAGE_PREFIX}settings`, JSON.stringify({ ...earlier, settingsVersion: 2, theme: 'dark' }));
    const migrated = createReaderStorage(disk);
    expect(migrated.getSettings()).toEqual({ ...defaultSettings, theme: 'dark' });
    expect(migrated.getStatus().corrupted).toBe(false);
    migrated.saveSettings({ ...migrated.getSettings(), speechRate: 1.4, speechVoiceURI: 'test-ja' });
    expect(createReaderStorage(disk).getSettings()).toMatchObject({ speechRate: 1.4, speechVoiceURI: 'test-ja', theme: 'dark' });
    disk.setItem(`${STORAGE_PREFIX}settings`, JSON.stringify({ ...defaultSettings, speechRate: 50, speechVoiceURI: {}, theme: 'dark' }));
    const invalid = createReaderStorage(disk);
    expect(invalid.getSettings()).toEqual({ ...defaultSettings, theme: 'dark' });
    expect(invalid.getStatus().corrupted).toBe(true);
  });
  it('uses stone rendering by default for a new reader', () => {
    const state = createReaderStorage(new MemoryStorage());
    expect(state.getSettings().renderingMode).toBe('stone');
    expect(state.getStatus().corrupted).toBe(false);
  });

  it('adds stone rendering to earlier settings without resetting preferences or reporting corruption', () => {
    const disk = new MemoryStorage();
    const { renderingMode: _renderingMode, ...earlierSettings } = defaultSettings;
    disk.setItem(`${STORAGE_PREFIX}settings`, JSON.stringify({ ...earlierSettings, settingsVersion: 2,
      direction: 'lrTb', fontSize: 28, lineHeight: 2.2, theme: 'dark' }));
    const state = createReaderStorage(disk);
    expect(state.getSettings()).toEqual({ ...defaultSettings, direction: 'lrTb', fontSize: 28,
      lineHeight: 2.2, theme: 'dark' });
    expect(state.getStatus().corrupted).toBe(false);
  });

  it.each(['stone', 'css'] as const)('persists the %s renderer across sessions', (renderingMode) => {
    const disk = new MemoryStorage();
    const settings = { ...defaultSettings, renderingMode, direction: 'lrTb' as const,
      fontSize: 28, theme: 'dark' as const };
    expect(createReaderStorage(disk).saveSettings(settings)).toBe(true);
    const reopened = createReaderStorage(disk);
    expect(reopened.getSettings()).toEqual(settings);
    expect(reopened.getStatus().corrupted).toBe(false);
  });

  it('resets only an invalid renderer while retaining valid reader preferences', () => {
    const disk = new MemoryStorage();
    disk.setItem(`${STORAGE_PREFIX}settings`, JSON.stringify({ ...defaultSettings, settingsVersion: 2,
      renderingMode: 'unknown', direction: 'lrTb', fontSize: 28, theme: 'dark' }));
    const state = createReaderStorage(disk);
    expect(state.getSettings()).toEqual({ ...defaultSettings, direction: 'lrTb', fontSize: 28,
      theme: 'dark' });
    expect(state.getStatus().corrupted).toBe(true);
  });

  it('adds typography defaults to an earlier six-field settings record', () => {
    const disk = new MemoryStorage();
    disk.setItem(`${STORAGE_PREFIX}settings`, JSON.stringify({ direction: 'lrTb', fontSize: 28, lineHeight: 2.2, font: 'sans', theme: 'dark', ruby: false }));
    const state = createReaderStorage(disk);
    expect(state.getSettings()).toEqual({ ...defaultSettings, direction: 'lrTb', fontSize: 28, lineHeight: 2.2, font: 'sans', theme: 'dark', ruby: false });
    expect(state.getStatus().corrupted).toBe(false);
  });

  it("keeps page-turn animation off for new and older readers without resetting preferences", () => {
    const disk = new MemoryStorage();
    expect(createReaderStorage(disk).getSettings().pageTurnAnimation).toBe(
      false,
    );
    const { pageTurnAnimation: _pageTurnAnimation, ...earlierSettings } =
      defaultSettings;
    disk.setItem(
      `${STORAGE_PREFIX}settings`,
      JSON.stringify({
        ...earlierSettings,
        settingsVersion: 2,
        direction: "lrTb",
        fontSize: 28,
        theme: "dark",
      }),
    );
    const reopened = createReaderStorage(disk);
    expect(reopened.getSettings()).toEqual({
      ...defaultSettings,
      direction: "lrTb",
      fontSize: 28,
      theme: "dark",
    });
    expect(reopened.getStatus().corrupted).toBe(false);
  });

  it("keeps page display for older settings and persists the scroll preference", () => {
    const disk = new MemoryStorage();
    const { viewMode: _viewMode, ...earlierSettings } = defaultSettings;
    disk.setItem(
      `${STORAGE_PREFIX}settings`,
      JSON.stringify({
        ...earlierSettings,
        settingsVersion: 2,
        direction: "lrTb",
        fontSize: 28,
      }),
    );
    const state = createReaderStorage(disk);
    expect(state.getSettings()).toEqual({
      ...defaultSettings,
      direction: "lrTb",
      fontSize: 28,
    });
    expect(state.getStatus().corrupted).toBe(false);
    state.saveSettings({ ...state.getSettings(), viewMode: "scroll" });
    expect(createReaderStorage(disk).getSettings().viewMode).toBe("scroll");
    disk.setItem(
      `${STORAGE_PREFIX}settings`,
      JSON.stringify({
        ...defaultSettings,
        settingsVersion: 2,
        viewMode: "invalid",
        theme: "dark",
      }),
    );
    expect(createReaderStorage(disk).getSettings()).toEqual({
      ...defaultSettings,
      theme: "dark",
    });
  });

  it('persists all typography controls, including modern 1.6 spacing without legacy migration', () => {
    const disk = new MemoryStorage();
    const settings = { ...defaultSettings, fontSize: 47, lineHeight: 1.6, font: 'noto-sans' as const,
      latinFont: 'georgia' as const, latinScale: 0.83, punctuationMode: 'whole' as const,
      pageLayout: 'spread' as const,
      pageTurnAnimation: true,
      paginationMode: 'all' as const,
      textAlign: 'justify' as const, directionAlign: 'end' as const,
      kinsoku: false, dividesByWords: false, allowsTateChuYoko: false, showFrames: false };
    expect(createReaderStorage(disk).saveSettings(settings)).toBe(true);
    const reopened = createReaderStorage(disk);
    expect(reopened.getSettings()).toEqual(settings);
    expect(reopened.getStatus().corrupted).toBe(false);
  });

  it('rejects invalid new typography fields independently of valid saved preferences', () => {
    const disk = new MemoryStorage();
    disk.setItem(`${STORAGE_PREFIX}settings`, JSON.stringify({ ...defaultSettings, theme: 'dark', font: '__proto__',
      latinFont: 'unknown', latinScale: 99, textAlign: 'unknown', directionAlign: 'unknown',
      punctuationMode: 'unknown', showFrames: 'yes', pageLayout: 'invalid', paginationMode: 'invalid' }));
    const state = createReaderStorage(disk);
    expect(state.getSettings()).toEqual({ ...defaultSettings, theme: 'dark' });
    expect(state.getStatus().corrupted).toBe(true);
  });

  it('restores settings, text anchors and bookmarks after a new session', () => {
    const disk = new MemoryStorage();
    const first = createReaderStorage(disk);
    expect(first.saveSettings({ ...defaultSettings, direction: 'lrTb', theme: 'dark', ruby: false })).toBe(true);
    expect(first.saveRecord('work / 日本語', record())).toBe(true);
    const second = createReaderStorage(disk);
    expect(second.getSettings()).toEqual({ ...defaultSettings, direction: 'lrTb', theme: 'dark', ruby: false });
    expect(second.getRecord('work / 日本語')).toEqual(record());
    const read = second.getRecord('work / 日本語')!;
    read.bookmarks.length = 0;
    expect(second.getRecord('work / 日本語')?.bookmarks).toHaveLength(1);
  });

  it('retains the widest line spacing when settings are saved and reopened', () => {
    const disk = new MemoryStorage();
    const settings = { ...defaultSettings, lineHeight: 2.5, direction: 'lrTb' as const,
      fontSize: 28, font: 'sans' as const, theme: 'dark' as const, ruby: false };
    expect(createReaderStorage(disk).saveSettings(settings)).toBe(true);
    const nextSession = createReaderStorage(disk);
    expect(nextSession.getSettings()).toEqual(settings);
    expect(nextSession.getStatus().corrupted).toBe(false);
  });

  it('upgrades legacy tight spacing while preserving every other preference', () => {
    const disk = new MemoryStorage();
    const legacy = { ...defaultSettings, lineHeight: 1.6, direction: 'lrTb' as const,
      fontSize: 32, font: 'sans' as const, theme: 'dark' as const, ruby: false };
    disk.setItem(`${STORAGE_PREFIX}settings`, JSON.stringify(legacy));
    const state = createReaderStorage(disk);
    const migrated = state.getSettings();
    expect(migrated).toEqual({ ...legacy, lineHeight: 1.9 });
    expect(state.getStatus().corrupted).toBe(false);
    expect(state.saveSettings(migrated)).toBe(true);
    expect(JSON.parse(disk.getItem(`${STORAGE_PREFIX}settings`)!)).toEqual({ ...migrated, settingsVersion: 2 });
    expect(createReaderStorage(disk).getSettings()).toEqual(migrated);
  });

  it('uses memory after a quota error, including the latest reading position', () => {
    const disk = new MemoryStorage();
    disk.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
    const state = createReaderStorage(disk);
    expect(state.saveRecord('127', record())).toBe(false);
    expect(state.getRecord('127')).toEqual(record());
    expect(state.getRecentRecords().map((item) => item.bookId)).toEqual(['127']);
    expect(state.getStatus().available).toBe(false);
  });

  it('keeps reading possible when storage access is denied', () => {
    const disk = new MemoryStorage();
    disk.getItem = () => { throw new DOMException('Access denied', 'SecurityError'); };
    const state = createReaderStorage(disk);
    expect(state.getSettings()).toEqual(defaultSettings);
    expect(state.getStatus().available).toBe(false);
    expect(createReaderStorage(null).saveRecord('127', record())).toBe(false);
  });

  it('isolates broken settings, malformed records and an individual broken bookmark', () => {
    const disk = new MemoryStorage();
    disk.setItem(`${STORAGE_PREFIX}settings`, JSON.stringify({ ...defaultSettings, fontSize: 999, theme: 'dark' }));
    disk.setItem(`${STORAGE_PREFIX}record:broken`, '{');
    disk.setItem(`${STORAGE_PREFIX}record:invalid`, JSON.stringify({ ...record(), progress: Infinity }));
    disk.setItem(`${STORAGE_PREFIX}record:valid`, JSON.stringify({ ...record(), bookmarks: [...record().bookmarks, { id: 'bad' }] }));
    const state = createReaderStorage(disk);
    expect(state.getSettings()).toEqual({ ...defaultSettings, theme: 'dark' });
    expect(state.getRecord('broken')).toBeNull();
    expect(state.getRecord('invalid')).toBeNull();
    expect(state.getRecord('valid')?.bookmarks).toEqual(record().bookmarks);
    expect(state.getRecentRecords().map((item) => item.bookId)).toEqual(['valid']);
    expect(state.getStatus().corrupted).toBe(true);
  });

  it('sorts history by date and limits it without erasing other records', () => {
    const disk = new MemoryStorage();
    const state = createReaderStorage(disk);
    state.saveRecord('older', record('2026-10-08T10:00:00.000Z'));
    state.saveRecord('newer', record('2026-10-09T10:00:00.000Z'));
    expect(createReaderStorage(disk).getRecentRecords(1).map((item) => item.bookId)).toEqual(['newer']);
    expect(state.getRecord('older')).not.toBeNull();
  });

  it('deletes only this app keys across schema versions', () => {
    const disk = new MemoryStorage();
    disk.setItem('another-reader:settings', 'keep me');
    disk.setItem(`${APP_STORAGE_PREFIX}v0:settings`, 'old settings');
    const state = createReaderStorage(disk);
    state.saveRecord('127', record());
    state.saveSettings(defaultSettings);
    expect(state.clear()).toBe(true);
    expect([...disk.items.keys()]).toEqual(['another-reader:settings']);
    expect(state.getRecord('127')).toBeNull();
    expect(state.getSettings()).toEqual(defaultSettings);
  });

  it('clears memory even if persistent deletion fails', () => {
    const disk = new MemoryStorage();
    const state = createReaderStorage(disk);
    state.saveRecord('127', record());
    disk.removeItem = () => { throw new Error('denied'); };
    expect(state.clear()).toBe(false);
    expect(state.getRecord('127')).toBeNull();
    expect(state.getRecentRecords()).toEqual([]);
    expect(state.getStatus().available).toBe(false);
  });
});

function block(id: string, text: string, kind: TextBlock['kind'] = 'paragraph'): TextBlock {
  return { id, text, kind, rubies: [], emphasis: [], inlineImages: [], indent: 0 };
}
function book(blocks: TextBlock[], contentVersion = 'v1'): Pick<Book, 'blocks' | 'contentVersion' | 'toc'> {
  return { blocks, contentVersion, toc: blocks.filter((item) => item.kind === 'heading').map((item) => ({ title: item.text, blockId: item.id, level: 1 })) };
}

describe('stable reading anchors', () => {
  it('does not persist page numbers and restores the same UTF-16 offset in the same version', () => {
    const original = book([block('first', 'ある日の事である。')]);
    const anchor = createAnchor(original, 'first', 4);
    expect(anchor).toMatchObject({ blockId: 'first', offset: 4, context: '事である。' });
    expect(restoreAnchor(original, anchor, 'v1')).toEqual({ anchor, adjusted: false, reason: 'exact' });
  });

  it('moves to the uniquely matching prose after text insertion and block-id changes', () => {
    const original = book([block('first', 'ある日の事である。続きがある。')]);
    const saved = createAnchor(original, 'first', 4);
    const updated = book([block('renamed', '新しい前書き。ある日の事である。続きがある。')], 'v2');
    const restored = restoreAnchor(updated, saved, 'v1');
    expect(restored.reason).toBe('context');
    expect(restored.adjusted).toBe(true);
    expect(updated.blocks[0].text.slice(restored.anchor.offset)).toBe(saved.context);
  });

  it('keeps the exact reading and bookmark position for an explicitly compatible gaiji normalization', () => {
    const original = book([block('first', '冒頭。'), block('saved', 'すると\ufffc陀多がいた。')]);
    const saved = createAnchor(original, 'saved', 3);
    const updated = {
      ...book([block('first', '冒頭。'), block('saved', 'すると犍陀多がいた。')], 'v2'),
      conversion: { positionCompatibleVersions: ['v1'] },
    };
    expect(restoreAnchor(updated, saved, 'v1')).toMatchObject({
      anchor: { blockId: 'saved', offset: 3, context: '犍陀多がいた。' },
      adjusted: false, reason: 'exact',
    });
    expect(restoreAnchor(updated, saved, 'unrelated-version')).toMatchObject({
      anchor: { blockId: 'first', offset: 0 }, adjusted: true, reason: 'start',
    });
  });

  it('maps source-edition anchors across supplementary, combining and BMP gaiji', () => {
    const original = book([block('saved', '前\ufffc中\ufffc後\ufffc終')]);
    const updated = {
      ...book([block('saved', '前𤄃中か\u309a後犍終')], 'v2'),
      conversion: {
        sourcePlaceholderVersion: 'v1',
        normalizedGaiji: [
          { blockId: 'saved', start: 7, end: 8, character: '犍' },
          { blockId: 'saved', start: 1, end: 3, character: '𤄃' },
          { blockId: 'saved', start: 4, end: 6, character: 'か\u309a' },
        ],
      },
    };
    for (const [before, after] of [[0, 0], [1, 1], [2, 3], [3, 4], [4, 6], [5, 7], [6, 8], [7, 9]]) {
      const result = restoreAnchor(updated, createAnchor(original, 'saved', before), 'v1');
      expect(result).toEqual({ anchor: createAnchor(updated, 'saved', after), adjusted: before !== after, reason: 'exact' });
    }
  });

  it('uses gaiji offset mapping only for the recorded source edition', () => {
    const updated = {
      ...book([block('chapter', '第二章', 'heading'), block('saved', '前𤄃中')], 'v2'),
      conversion: {
        sourcePlaceholderVersion: 'v1',
        normalizedGaiji: [{ blockId: 'saved', start: 1, end: 3, character: '𤄃' }],
      },
    };
    const saved = { blockId: 'saved', offset: 1, context: '\ufffc中' };
    expect(restoreAnchor(updated, saved, 'unrelated-version')).toMatchObject({
      anchor: { blockId: 'chapter', offset: 0 }, adjusted: true, reason: 'heading',
    });
    updated.conversion.normalizedGaiji[0].end = 2;
    expect(restoreAnchor(updated, saved, 'v1')).toMatchObject({
      anchor: { blockId: 'chapter', offset: 0 }, adjusted: true, reason: 'heading',
    });
  });

  it('falls back to a preceding heading for ambiguous text instead of rebinding a bookmark', () => {
    const updated = book([block('chapter', '第二章', 'heading'), block('saved', '同じ文章。同じ文章。')], 'v2');
    const result = restoreAnchor(updated, { blockId: 'saved', offset: 0, context: '同じ文章。' }, 'v1');
    expect(result.reason).toBe('heading');
    expect(result.anchor.blockId).toBe('chapter');
  });

  it('starts at the beginning when the old prose and block no longer exist', () => {
    const updated = book([block('intro', '新しい本文')], 'v2');
    const result = restoreAnchor(updated, { blockId: 'gone', offset: 50, context: '削除された本文' }, 'v1');
    expect(result).toMatchObject({ anchor: { blockId: 'intro', offset: 0 }, adjusted: true, reason: 'start' });
  });

  it('does not split surrogate pairs, combining marks or variation selectors', () => {
    const sample = book([block('unicode', 'A𠮷か\u3099葛\u{E0100}B')]);
    expect(createAnchor(sample, 'unicode', 2).offset).toBe(1);
    expect(createAnchor(sample, 'unicode', 4).offset).toBe(3);
    expect(createAnchor(sample, 'unicode', 6).offset).toBe(5);
    expect(createAnchor(sample, 'unicode', 7).offset).toBe(5);
  });

  it('calculates progress from text only and handles empty books', () => {
    const sample = book([block('a', 'あいうえお'), block('b', 'かきくけこ')]);
    expect(anchorProgress(sample, { blockId: 'b', offset: 2, context: '' })).toBe(0.7);
    expect(anchorProgress(book([]), { blockId: '', offset: 0, context: '' })).toBe(0);
  });
});

const entry = (id: string, title: string, titleKana: string, author = '夏目 漱石', kana = 'なつめ そうせき'): CatalogEntry => ({
  id, title, titleKana, subtitle: '', authorLabel: author,
  authors: [{ id: '1', name: author, kana, role: '著者' }], cardUrl: '', dataPath: '', contentVersion: 'v1',
  characterCount: 100, excerpt: '', features: [],
});

describe('catalog search', () => {
  it('normalizes width, case and katakana without changing displayed metadata', () => {
    expect(normalizeSearch('  ｶﾞｸ ＡＢＣ  ')).toBe('がく abc');
    const catalog = [entry('1', '吾輩は猫である', 'ワガハイハネコデアル')];
    expect(filterCatalog(catalog, 'ﾈｺ 夏目')).toEqual(catalog);
    expect(catalog[0].titleKana).toBe('ワガハイハネコデアル');
  });

  it('searches subtitle and translator readings and requires every query word', () => {
    const translation = entry('2', '幸福な王子', 'こうふくなおうじ', 'ワイルド', 'わいるど');
    translation.subtitle = '童話';
    translation.authors.push({ id: '2', name: '結城 浩', kana: 'ゆうき ひろし', role: '翻訳者' });
    expect(filterCatalog([translation], 'ユウキ 童話')).toHaveLength(1);
    expect(filterCatalog([translation], 'ユウキ 存在しない')).toEqual([]);
  });

  it('sorts deterministically with ids as a tie breaker and preserves source order', () => {
    const catalog = [entry('20', '同題', 'どうだい'), entry('3', '同題', 'どうだい'), entry('1', 'あ', 'あ')];
    expect(filterCatalog(catalog, '', 'title').map((item) => item.id)).toEqual(['1', '3', '20']);
    expect(catalog.map((item) => item.id)).toEqual(['20', '3', '1']);
    expect(filterCatalog(catalog, '', 'author').map((item) => item.id)).toEqual(['1', '3', '20']);
  });
});
