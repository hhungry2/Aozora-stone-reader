import { defaultSettings, fontFamilies, latinFontFamilies } from '../types';
import type { Anchor, Bookmark, ReaderSettings, ReadingRecord } from '../types';

export const APP_STORAGE_PREFIX = 'aozora-stone-reader:';
export const STORAGE_PREFIX = `${APP_STORAGE_PREFIX}v1:`;
const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;
const RECORD_PREFIX = `${STORAGE_PREFIX}record:`;

/** The small Storage interface also makes denied/quota-limited storage testable. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StorageStatus { available: boolean; corrupted: boolean }
export interface RecentRecord { bookId: string; record: ReadingRecord }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

function isAnchor(value: unknown): value is Anchor {
  return isObject(value) && isText(value.blockId, 200) && value.blockId.length > 0 &&
    typeof value.offset === 'number' && Number.isSafeInteger(value.offset) && value.offset >= 0 &&
    isText(value.context, 200);
}

function isBookmark(value: unknown): value is Bookmark {
  return isObject(value) && isText(value.id, 200) && value.id.length > 0 &&
    isAnchor(value.anchor) && isDate(value.createdAt) && isText(value.excerpt, 500);
}

function browserStorage(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

export function createReaderStorage(storage: StorageLike | null = browserStorage()) {
  // Memory remains authoritative during a session when a write or delete fails.
  const memory = new Map<string, string | null>();
  const status: StorageStatus = { available: storage !== null, corrupted: false };
  let enumerationComplete = true;
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  function read(key: string): unknown {
    let raw = memory.get(key);
    if (!memory.has(key)) {
      try { raw = storage?.getItem(key) ?? null; }
      catch { status.available = false; raw = null; }
      memory.set(key, raw ?? null);
    }
    if (raw == null) return null;
    try { return JSON.parse(raw) as unknown; }
    catch { status.corrupted = true; return null; }
  }

  function write(key: string, value: unknown): boolean {
    const raw = JSON.stringify(value);
    memory.set(key, raw);
    if (!storage) return false;
    try { storage.setItem(key, raw); return true; }
    catch { status.available = false; return false; }
  }

  function allKeys(): string[] {
    enumerationComplete = true;
    const keys = new Set(memory.keys());
    if (storage) {
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key) keys.add(key);
        }
      } catch { status.available = false; enumerationComplete = false; }
    }
    return [...keys];
  }

  function settingsFrom(value: unknown): ReaderSettings {
    const result = { ...defaultSettings };
    if (value === null) return result;
    if (!isObject(value)) { status.corrupted = true; return result; }
    // Upgrade the former tight spacing without discarding the reader's other settings.
    const lineHeight = value.settingsVersion !== 2 && value.lineHeight === 1.6 ? 1.9 : value.lineHeight;
    const inSteps = (input: unknown, min: number, max: number, step: number) =>
      typeof input === 'number' && Number.isFinite(input) && input >= min && input <= max &&
      Math.abs((input - min) / step - Math.round((input - min) / step)) < 0.00001;
    const valid: Record<keyof ReaderSettings, boolean> = {
      direction: value.direction === 'tbRl' || value.direction === 'lrTb',
      fontSize: inSteps(value.fontSize, 10, 48, 1),
      lineHeight: inSteps(lineHeight, 1, 3, 0.05),
      font: typeof value.font === 'string' && Object.hasOwn(fontFamilies, value.font),
      latinFont: typeof value.latinFont === 'string' && Object.hasOwn(latinFontFamilies, value.latinFont),
      latinScale: inSteps(value.latinScale, 0.6, 1.2, 0.01),
      punctuationMode: ['stone', 'whole', 'half'].includes(value.punctuationMode as string),
      textAlign: ['leading', 'center', 'trailing', 'justify'].includes(value.textAlign as string),
      directionAlign: ['start', 'middle', 'end'].includes(value.directionAlign as string),
      kinsoku: typeof value.kinsoku === 'boolean',
      dividesByWords: typeof value.dividesByWords === 'boolean',
      allowsTateChuYoko: typeof value.allowsTateChuYoko === 'boolean',
      showFrames: typeof value.showFrames === 'boolean',
      theme: value.theme === 'paper' || value.theme === 'light' || value.theme === 'dark',
      ruby: typeof value.ruby === 'boolean',
    };
    for (const key of Object.keys(valid) as (keyof ReaderSettings)[]) {
      if (valid[key]) Object.assign(result, { [key]: key === 'lineHeight' ? lineHeight : value[key] });
      // Earlier releases did not save these additional typography preferences.
      else if (Object.hasOwn(value, key) || ['direction', 'fontSize', 'lineHeight', 'font', 'theme', 'ruby'].includes(key)) status.corrupted = true;
    }
    return result;
  }

  function recordFrom(value: unknown): ReadingRecord | null {
    if (value === null) return null;
    if (!isObject(value) || !isText(value.contentVersion, 200) || !value.contentVersion ||
      !isAnchor(value.anchor) || !isDate(value.updatedAt) || typeof value.progress !== 'number' ||
      !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 1 || !Array.isArray(value.bookmarks)) {
      status.corrupted = true;
      return null;
    }
    const bookmarks: Bookmark[] = [];
    const ids = new Set<string>();
    for (const item of value.bookmarks.slice(0, 500)) {
      if (isBookmark(item) && !ids.has(item.id)) { bookmarks.push(item); ids.add(item.id); }
      else status.corrupted = true;
    }
    if (value.bookmarks.length > 500) status.corrupted = true;
    return clone({ contentVersion: value.contentVersion, anchor: value.anchor,
      updatedAt: value.updatedAt, progress: value.progress, bookmarks });
  }

  function getRecord(bookId: string): ReadingRecord | null {
    return recordFrom(read(`${RECORD_PREFIX}${encodeURIComponent(bookId)}`));
  }

  return {
    getSettings: (): ReaderSettings => settingsFrom(read(SETTINGS_KEY)),
    saveSettings: (settings: ReaderSettings): boolean => write(SETTINGS_KEY, { ...settingsFrom({ ...settings, settingsVersion: 2 }), settingsVersion: 2 }),
    getRecord,
    saveRecord(bookId: string, record: ReadingRecord): boolean {
      const validated = recordFrom(record);
      return validated ? write(`${RECORD_PREFIX}${encodeURIComponent(bookId)}`, validated) : false;
    },
    getRecentRecords(limit = 20): RecentRecord[] {
      const records: RecentRecord[] = [];
      for (const key of allKeys()) {
        if (!key.startsWith(RECORD_PREFIX)) continue;
        try {
          const bookId = decodeURIComponent(key.slice(RECORD_PREFIX.length));
          const record = getRecord(bookId);
          if (bookId && record) records.push({ bookId, record });
        } catch { status.corrupted = true; }
      }
      return records.sort((a, b) => Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt) || a.bookId.localeCompare(b.bookId))
        .slice(0, Math.max(0, Math.floor(limit)));
    },
    getStatus: (): StorageStatus => ({ ...status }),
    clear(): boolean {
      const keys = allKeys();
      let success = storage !== null && enumerationComplete;
      for (const key of keys) {
        // Delete every schema version belonging to this app, never another site's keys.
        if (!key.startsWith(APP_STORAGE_PREFIX)) continue;
        memory.set(key, null);
        try { storage?.removeItem(key); }
        catch { success = false; status.available = false; }
      }
      status.corrupted = false;
      return success;
    },
  };
}

export const readerStorage = createReaderStorage();
