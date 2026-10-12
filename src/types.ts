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
  availability?: "available" | "source-only";
  unavailableReason?: string;
  orthography?: string;
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

export const fontFamilies = {
  serif:
    '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif CJK JP", "MS PMincho", serif',
  sans: '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", sans-serif',
  "noto-sans": '"Noto Sans JP", "Yu Gothic", sans-serif',
  "noto-serif": '"Noto Serif JP", "Yu Mincho", serif',
  "zen-kaku": '"Zen Kaku Gothic New", "Yu Gothic", sans-serif',
  shippori: '"Shippori Mincho", "Yu Mincho", serif',
  "hiragino-sans":
    '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif',
  "hiragino-serif": '"Hiragino Mincho ProN", "Noto Serif JP", serif',
};

export const japaneseFontOptions = [
  ["noto-sans", "Noto Sans JP"],
  ["noto-serif", "Noto Serif JP"],
  ["zen-kaku", "Zen Kaku Gothic New"],
  ["shippori", "Shippori Mincho"],
  ["hiragino-sans", "ヒラギノ角ゴ（macOS）"],
  ["hiragino-serif", "ヒラギノ明朝（macOS）"],
  ["serif", "端末の明朝体"],
  ["sans", "端末のゴシック体"],
] as const;

export const latinFontFamilies = {
  helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
  georgia: "Georgia, serif",
  same: "",
};

export const latinFontOptions = [
  ["helvetica", "Helvetica Neue"],
  ["times", "Times New Roman"],
  ["georgia", "Georgia"],
  ["same", "和文フォントと同じ"],
] as const;

export interface ReaderSettings {
  renderingMode: "stone" | "css";
  direction: "tbRl" | "lrTb";
  viewMode: "pages" | "scroll";
  pageLayout: "single" | "spread";
  pageTurnAnimation: boolean;
  paginationMode: "on-demand" | "batch" | "all";
  fontSize: number;
  lineHeight: number;
  font: keyof typeof fontFamilies;
  latinFont: keyof typeof latinFontFamilies;
  latinScale: number;
  punctuationMode: "stone" | "whole" | "half";
  textAlign: "leading" | "center" | "trailing" | "justify";
  directionAlign: "start" | "middle" | "end";
  kinsoku: boolean;
  dividesByWords: boolean;
  allowsTateChuYoko: boolean;
  showFrames: boolean;
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
  renderingMode: "stone",
  direction: "tbRl",
  viewMode: "pages",
  pageLayout: "single",
  pageTurnAnimation: false,
  paginationMode: "on-demand",
  fontSize: 20,
  lineHeight: 1.9,
  font: "serif",
  latinFont: "helvetica",
  latinScale: 0.95,
  punctuationMode: "stone",
  textAlign: "leading",
  directionAlign: "start",
  kinsoku: true,
  dividesByWords: true,
  allowsTateChuYoko: true,
  showFrames: true,
  theme: "paper",
  ruby: true,
};
