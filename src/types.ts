export interface Person {
  id: string;
  name: string;
  kana: string;
  role: string;
}

export interface CatalogEntry {
  id: string;
  title: string;
  titleKana: string;
  subtitle: string;
  authors: Person[];
  authorLabel: string;
  cardUrl: string;
  dataPath: string;
  contentVersion: string;
  characterCount: number;
  excerpt: string;
  features: string[];
}

export interface RubyRange {
  start: number;
  end: number;
  reading: string;
}
export interface EmphasisRange {
  start: number;
  end: number;
  kind: string;
}
export interface ImageAsset {
  src: string;
  alt: string;
  sourceUrl: string;
}
export interface InlineImage extends ImageAsset {
  start: number;
  end: number;
}

export interface GaijiNormalization {
  blockId: string;
  start: number;
  end: number;
  character: string;
  codePoint: string;
  jisCode: string;
  encoding: string;
  referenceUrl: string;
  sourceUrl: string;
  sourceNote: string;
}

export interface TextBlock {
  id: string;
  kind: "paragraph" | "heading" | "image" | "note";
  text: string;
  rubies: RubyRange[];
  emphasis: EmphasisRange[];
  inlineImages: InlineImage[];
  indent: number;
  level?: number;
  image?: ImageAsset;
}

export interface Book extends CatalogEntry {
  schemaVersion: 1;
  blocks: TextBlock[];
  toc: { title: string; blockId: string; level: number }[];
  credits: string;
  source: { url: string; fetchedAt: string; sha256: string; encoding: string };
  conversion: {
    version: string;
    warnings: string[];
    normalizedGaiji?: GaijiNormalization[];
    sourcePlaceholderVersion?: string;
    positionCompatibleVersions?: string[];
  };
}

export interface Anchor {
  blockId: string;
  offset: number;
  context: string;
}

export interface ReaderSettings {
  direction: "tbRl" | "lrTb";
  fontSize: number;
  lineHeight: number;
  font: "serif" | "sans";
  theme: "paper" | "light" | "dark";
  ruby: boolean;
}

export interface Bookmark {
  id: string;
  anchor: Anchor;
  createdAt: string;
  excerpt: string;
}

export interface ReadingRecord {
  contentVersion: string;
  anchor: Anchor;
  updatedAt: string;
  progress: number;
  bookmarks: Bookmark[];
}

export const defaultSettings: ReaderSettings = {
  direction: "tbRl",
  fontSize: 20,
  lineHeight: 1.9,
  font: "serif",
  theme: "paper",
  ruby: true,
};

export const fontFamilies = {
  serif:
    '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif CJK JP", "MS PMincho", serif',
  sans: '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", sans-serif',
};
