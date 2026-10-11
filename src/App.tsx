import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useDeferredValue,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark as BookmarkIcon,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Info,
  List,
  LoaderCircle,
  Minus,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { anchorProgress, createAnchor, restoreAnchor } from "./lib/anchors";
import {
  CATALOG_PAGE_SIZE,
  createCatalogIndex,
  type CatalogSort,
} from "./lib/catalog";
import { fetchJson } from "./lib/data";
import { displayTitle } from "./lib/titles";
import { readerStorage } from "./lib/state";
import { usePagination } from "./reader/usePagination";
import {
  CssReader,
  type CssReaderHandle,
  type CssReaderLocation,
} from "./reader/CssReader";
import {
  type Anchor,
  type Book,
  type CatalogEntry,
  type ReaderSettings,
  type ReadingRecord,
  defaultSettings,
  japaneseFontOptions,
  latinFontOptions,
} from "./types";

const ReaderPages = lazy(async () => ({
  default: (await import("./reader/ReaderPage")).ReaderPages,
}));

const assetUrl = (path: string) =>
  new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI)).href;
const formatMinutes = (characters: number) => {
  const minutes = Math.max(1, Math.round(characters / 500));
  return minutes >= 60
    ? `約${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ""}`
    : `約${minutes}分`;
};
const palettes = ["pine", "clay", "slate", "olive", "wine", "ochre"];
function getRoute() {
  const [screen, id] = location.hash.replace(/^#\/?/, "").split("/");
  return {
    screen: screen === "works" ? "read" : screen || "library",
    id: id || "",
  };
}
function navigate(path: string) {
  location.hash = path;
}

class ReaderBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="empty-state">
        <Info />
        <h2>表示を再開できませんでした</h2>
        <p>ページを再読み込みして、保存した位置から再開できます。</p>
        <button className="button primary" onClick={() => location.reload()}>
          再読み込み
        </button>
        <a className="text-link" href="#/">
          本棚に戻る
        </a>
      </div>
    ) : (
      this.props.children
    );
  }
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a
      className={`brand ${compact ? "compact" : ""}`}
      href="#/"
      aria-label="Aozora Stone Reader 本棚へ"
    >
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span>
        <strong>Aozora Stone Reader</strong>
        <small>縦・横表示対応の青空文庫リーダー</small>
      </span>
    </a>
  );
}

function BookCover({
  book,
  index = 0,
}: {
  book: CatalogEntry;
  index?: number;
}) {
  return (
    <div
      className={`book-cover ${palettes[index % palettes.length]}`}
      aria-hidden="true"
    >
      <span className="cover-edition">青空文庫</span>
      <span className="cover-line" />
      <span
        className={`cover-title${displayTitle(book.title).length > 12 ? " long" : ""}`}
      >
        {displayTitle(book.title)
          .split(/([0-9０-９]+)/u)
          .map((part, index) =>
            /^[0-9０-９]{1,2}$/u.test(part) ? (
              <span className="cover-tcy" key={index}>
                {part}
              </span>
            ) : (
              part
            ),
          )}
      </span>
      <span className="cover-author">{book.authorLabel}</span>
      <span className="cover-no">{String(index + 1).padStart(2, "0")}</span>
      <span className="cover-grain" />
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function About({
  onClose,
  onClear,
  bookCount,
  sourceOnlyCount,
}: {
  onClose: () => void;
  onClear: () => void;
  bookCount: number;
  sourceOnlyCount: number;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Modal title="この文庫について" onClose={onClose}>
      <div className="about-content">
        <p className="serif lead">文学を、心地よく。</p>
        <p>
          青空文庫の作品を、縦書きでも横書きでも。日本語組版エンジン
          stone-engine.js を使った、小さなブラウザの文庫です。
        </p>
        <p>
          著作権が消滅した{bookCount.toLocaleString()}
          作品を検索できます。文字の大きさや行間を整えて、あなたに合う読み方を見つけてください。
        </p>
        {sourceOnlyCount > 0 && (
          <p>
            本文を読める作品は{(bookCount - sourceOnlyCount).toLocaleString()}
            作品です。 外部サイト等で提供される{sourceOnlyCount}
            作品は、公式図書カードへ案内します。
          </p>
        )}
        <h3>作品の出典</h3>
        <p>
          作品本文・書誌情報は青空文庫から取得し、表示用に形式を変換しています。底本・入力者・校正者等は各作品の「作品情報」に掲載しています。このアプリは青空文庫の公式サービスではありません。
        </p>
        <a
          className="external-link"
          href="https://www.aozora.gr.jp/"
          target="_blank"
          rel="noreferrer"
        >
          青空文庫 <ExternalLink size={14} />
        </a>
        <a
          className="external-link"
          href="https://www.aozora.gr.jp/guide/kijyunn.html"
          target="_blank"
          rel="noreferrer"
        >
          収録ファイルの取り扱い規準 <ExternalLink size={14} />
        </a>
        <p className="fine-print">
          書誌データ：青空文庫 / CC BY
          4.0（項目の抽出と形式変換を実施）。本文の権利状態とは区別して扱います。
        </p>
        <h3>組版とライセンス</h3>
        <p>
          stone-engine.js 0.2.0 / MIT License
          <br />
          Copyright © 2024 Nihon Design Center
        </p>
        <p className="fine-print">
          React・React DOM / MIT、Lucide / ISC。各許諾文は以下に掲載しています。
        </p>
        <a
          className="external-link"
          href={assetUrl("licenses.txt")}
          target="_blank"
          rel="noreferrer"
        >
          第三者ライセンス <ExternalLink size={14} />
        </a>
        <h3>読書の記録</h3>
        <p>
          設定・読書位置・しおりは、このブラウザだけに保存されます。端末間では同期されず、ブラウザのデータ削除で消去されます。アクセス解析や広告はありません。
        </p>
        {confirm ? (
          <div className="confirm-box">
            <p>このアプリの読書位置・しおり・設定を削除します。</p>
            <div className="button-row">
              <button
                className="button danger"
                onClick={() => {
                  onClear();
                  setConfirm(false);
                }}
              >
                削除する
              </button>
              <button className="button" onClick={() => setConfirm(false)}>
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <button
            className="text-link danger-text"
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={15} />
            端末内の保存データを削除
          </button>
        )}
      </div>
    </Modal>
  );
}

function WorkDetails({
  book,
  onRestart,
}: {
  book: Book;
  onRestart: () => void;
}) {
  return (
    <div
      className="reader-work-info-content"
      role="region"
      aria-label="作品情報の詳細"
      tabIndex={0}
    >
      <div className="reader-work-info-heading">
        <h2 className="serif">{displayTitle(book.title)}</h2>
        {book.subtitle && <p>{book.subtitle}</p>}
        <p>{book.authorLabel}</p>
        <p className="reader-work-info-facts">
          {formatMinutes(book.characterCount)} ·{" "}
          {book.characterCount.toLocaleString()}文字
        </p>
      </div>
      <div className="reader-work-info-actions">
        <a
          className="external-link"
          href={book.cardUrl}
          target="_blank"
          rel="noreferrer"
        >
          青空文庫の図書カード <ExternalLink size={14} />
        </a>
        <button className="text-link" onClick={onRestart}>
          最初から読む <ArrowRight size={15} />
        </button>
      </div>
      <details className="reader-credits">
        <summary>底本・制作情報</summary>
        <pre className="credits">{book.credits}</pre>
      </details>
      {book.conversion.warnings.length > 0 && (
        <details className="conversion-details">
          <summary>表示形式の変更について</summary>
          <p>
            原文の文字を保持し、以下の特殊な配置を読みやすい形式に整えています。
          </p>
          <ul>
            {book.conversion.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SettingRange({
  id,
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="setting-group typography-range">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id}>{display}</output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

const readerThemes = [
  ["light", "白"],
  ["paper", "生成り"],
  ["dark", "暗色"],
] as const;

function ReaderThemeToggle({
  settings,
  onChange,
}: {
  settings: ReaderSettings;
  onChange: (settings: ReaderSettings) => void;
}) {
  const themeIndex = readerThemes.findIndex(
    ([value]) => value === settings.theme,
  );
  const themeLabel = readerThemes[themeIndex][1];
  const nextTheme = readerThemes[(themeIndex + 1) % readerThemes.length];
  return (
    <button
      className="reader-theme-toggle"
      aria-label={`配色を切り替え（現在：${themeLabel}）`}
      title={`配色：${themeLabel}。クリックで${nextTheme[1]}に切り替え`}
      onClick={() => onChange({ ...settings, theme: nextTheme[0] })}
    >
      {settings.theme === "dark" ? (
        <Moon size={17} aria-hidden="true" />
      ) : (
        <Sun size={17} aria-hidden="true" />
      )}
      <span>{themeLabel}</span>
    </button>
  );
}

function ReaderQuickControls({
  settings,
  onChange,
  onOpen,
}: {
  settings: ReaderSettings;
  onChange: (settings: ReaderSettings) => void;
  onOpen: () => void;
}) {
  const [active, setActive] = useState<"fontSize" | "lineHeight" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    root.current?.querySelector<HTMLInputElement>("input")?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [active]);
  const close = () => {
    root.current
      ?.querySelector<HTMLButtonElement>(
        `[aria-controls="reader-${active}-control"]`,
      )
      ?.focus();
    setActive(null);
  };
  const toggle = (key: "fontSize" | "lineHeight") => {
    onOpen();
    setActive(active === key ? null : key);
  };
  const fontSize = active === "fontSize";
  const label = fontSize ? "フォントサイズ" : "行送り";
  const value = fontSize ? settings.fontSize : settings.lineHeight;
  const min = fontSize ? 10 : 1;
  const max = fontSize ? 48 : 3;
  const step = fontSize ? 1 : 0.05;
  const setValue = (next: number) => {
    if (active)
      onChange({
        ...settings,
        [active]: Math.max(min, Math.min(max, Math.round(next * 100) / 100)),
      });
  };
  return (
    <div
      className="reader-quick-controls"
      ref={root}
      role="group"
      aria-label="読書の調整"
      onKeyDown={(event) => {
        if (event.key === "Escape" && active) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (event.key === "Tab" && active) {
          requestAnimationFrame(() => {
            if (root.current && !root.current.contains(document.activeElement))
              setActive(null);
          });
        }
      }}
    >
      <button
        className="reader-quick-button"
        aria-label="フォントサイズを調整"
        aria-description={`現在の文字サイズ：${settings.fontSize}px`}
        title={`文字サイズ：${settings.fontSize}px`}
        aria-expanded={active === "fontSize"}
        aria-controls="reader-fontSize-control"
        onClick={() => toggle("fontSize")}
      >
        <span>文字</span>
        <strong>{settings.fontSize}px</strong>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      <button
        className="reader-quick-button"
        aria-label="行送りを調整"
        aria-description={`現在の行送り：${settings.lineHeight.toFixed(2)}倍`}
        title={`行送り：×${settings.lineHeight.toFixed(2)}`}
        aria-expanded={active === "lineHeight"}
        aria-controls="reader-lineHeight-control"
        onClick={() => toggle("lineHeight")}
      >
        <span>行送り</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {active && (
        <div
          id={`reader-${active}-control`}
          className="reader-adjustment"
          role="region"
          aria-label={`${label}の調整`}
        >
          <button
            className="adjustment-close"
            aria-label="調整を閉じる"
            onClick={close}
          >
            <X size={16} aria-hidden="true" />
          </button>
          <SettingRange
            id={fontSize ? "font-size" : "line-height"}
            label={label}
            value={value}
            min={min}
            max={max}
            step={step}
            display={fontSize ? `${value}px` : `×${value.toFixed(2)}`}
            onChange={setValue}
          />
          <div className="adjustment-steps">
            <button
              aria-label={`${label}を小さくする`}
              disabled={value <= min}
              onClick={() => setValue(value - step)}
            >
              <Minus size={16} aria-hidden="true" />
            </button>
            <span>{fontSize ? "10–48px" : "×1.00–3.00"}</span>
            <button
              aria-label={`${label}を大きくする`}
              disabled={value >= max}
              onClick={() => setValue(value + step)}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({
  settings,
  onChange,
}: {
  settings: ReaderSettings;
  onChange: (s: ReaderSettings) => void;
}) {
  const set = <K extends keyof ReaderSettings>(
    key: K,
    value: ReaderSettings[K],
  ) => onChange({ ...settings, [key]: value });
  const cssMode = settings.renderingMode === "css";
  return (
    <div className="settings-content">
      <div className="setting-group">
        <label htmlFor="rendering-mode">表示エンジン</label>
        <select
          id="rendering-mode"
          value={settings.renderingMode}
          onChange={(event) =>
            set(
              "renderingMode",
              event.target.value as ReaderSettings["renderingMode"],
            )
          }
          aria-describedby="rendering-mode-note"
        >
          <option value="stone">Stone（stone-engine.js）</option>
          <option value="css">CSS（ライブラリ未使用）</option>
        </select>
        <p id="rendering-mode-note" className="fine-print">
          {cssMode
            ? "ブラウザ標準の writing-mode と HTML で表示します。ページ送りは画面単位です。Stone 専用の設定は適用しません。"
            : "stone-engine.js で組版し、SVG で表示します。CSS モードに切り替えて同じ本文を比較できます。"}
        </p>
      </div>
      <div className="setting-group">
        <label htmlFor="page-layout">ページ表示</label>
        <select
          id="page-layout"
          disabled={cssMode}
          value={settings.pageLayout}
          onChange={(event) =>
            set(
              "pageLayout",
              event.target.value as ReaderSettings["pageLayout"],
            )
          }
        >
          <option value="single">1ページ</option>
          <option value="spread">見開き（横長の画面で2ページ）</option>
        </select>
      </div>
      <div className="setting-group">
        <label htmlFor="pagination-mode">ページの準備</label>
        <select
          id="pagination-mode"
          disabled={cssMode}
          value={settings.paginationMode}
          onChange={(event) =>
            set(
              "paginationMode",
              event.target.value as ReaderSettings["paginationMode"],
            )
          }
          aria-describedby="pagination-mode-note"
        >
          <option value="on-demand">必要なページだけ（従来）</option>
          <option value="batch">10ページ先読み</option>
          <option value="all">全ページ組版</option>
        </select>
        <p id="pagination-mode-note" className="fine-print">
          {cssMode
            ? "CSS モードでは本文全体をブラウザが配置します。見開きと先読みは Stone モードで利用できます。"
            : settings.paginationMode === "all"
              ? "読書を続けながら作品全体を準備します。長い作品ほど時間とメモリを使います。"
              : settings.paginationMode === "batch"
                ? "現在位置から先の10ページを準備し、読み進めるたびに補充します。"
                : "表示するページと次の1ページを準備します。"}
        </p>
      </div>
      <div className="setting-group">
        <label htmlFor="punctuation-mode">約物</label>
        <select
          id="punctuation-mode"
          disabled={cssMode}
          value={settings.punctuationMode}
          onChange={(event) =>
            set(
              "punctuationMode",
              event.target.value as ReaderSettings["punctuationMode"],
            )
          }
        >
          <option value="stone">stone</option>
          <option value="whole">常に全角</option>
          <option value="half">常に半角</option>
        </select>
      </div>
      <div className="typography-row">
        <div className="setting-group">
          <label htmlFor="text-align">文字寄せ</label>
          <select
            id="text-align"
            value={settings.textAlign}
            onChange={(event) =>
              set(
                "textAlign",
                event.target.value as ReaderSettings["textAlign"],
              )
            }
          >
            <option value="leading">行頭</option>
            <option value="center">中央</option>
            <option value="trailing">行末</option>
            <option value="justify">均等</option>
          </select>
        </div>
        <div className="setting-group">
          <label htmlFor="direction-align">行の寄せ</label>
          <select
            id="direction-align"
            disabled={cssMode}
            value={settings.directionAlign}
            onChange={(event) =>
              set(
                "directionAlign",
                event.target.value as ReaderSettings["directionAlign"],
              )
            }
          >
            <option value="start">start</option>
            <option value="middle">middle</option>
            <option value="end">end</option>
          </select>
        </div>
      </div>
      <div className="setting-group">
        <label htmlFor="japanese-font">和文フォント</label>
        <select
          id="japanese-font"
          value={settings.font}
          onChange={(event) =>
            set("font", event.target.value as ReaderSettings["font"])
          }
        >
          {japaneseFontOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="setting-group">
        <label htmlFor="latin-font">欧文フォント</label>
        <select
          id="latin-font"
          value={settings.latinFont}
          onChange={(event) =>
            set("latinFont", event.target.value as ReaderSettings["latinFont"])
          }
        >
          {latinFontOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <SettingRange
        id="latin-scale"
        label="欧文スケール"
        min={0.6}
        max={1.2}
        step={0.01}
        value={settings.latinScale}
        display={`×${settings.latinScale.toFixed(2)}`}
        onChange={(value) => set("latinScale", value)}
      />
      <div className="typography-checks">
        {(
          [
            ["kinsoku", "禁則処理"],
            ["dividesByWords", "単語で改行（単語を分割しない）"],
            ["allowsTateChuYoko", "縦中横"],
            ["showFrames", "文字の枠を表示"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              disabled={cssMode && key === "showFrames"}
              checked={settings[key]}
              onChange={(event) => set(key, event.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="setting-group switch-group">
        <div>
          <label htmlFor="ruby-switch">ルビを表示</label>
          <p>漢字に添えられた読みがな</p>
        </div>
        <button
          id="ruby-switch"
          className={`switch ${settings.ruby ? "on" : ""}`}
          role="switch"
          aria-checked={settings.ruby}
          onClick={() => set("ruby", !settings.ruby)}
        >
          <span />
        </button>
      </div>
      <button className="text-link" onClick={() => onChange(defaultSettings)}>
        初期設定に戻す
      </button>
    </div>
  );
}

export default function App() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [route, setRoute] = useState(getRoute);
  const [settings, setSettings] = useState(() => readerStorage.getSettings());
  const [about, setAbout] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CatalogSort>("recommended");
  const [filter, setFilter] = useState("all");
  const [author, setAuthor] = useState("");
  const [shelfPage, setShelfPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);
  const [recordVersion, setRecordVersion] = useState(0);
  const [toast, setToast] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [bookError, setBookError] = useState("");
  const [retry, setRetry] = useState(0);
  const [saveWarning, setSaveWarning] = useState("");
  const bookCache = useRef(new Map<string, Book>());
  const notify = useCallback((message: string) => {
    setToast(message);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const change = () => {
      const next = getRoute();
      if (/^#\/?works(?:\/|$)/u.test(location.hash)) {
        window.history.replaceState(
          window.history.state,
          "",
          `#/read/${next.id}`,
        );
      }
      setRoute(next);
      window.scrollTo(0, 0);
    };
    change();
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);
  useEffect(() => {
    const abort = new AbortController();
    setCatalogError(false);
    fetchJson<CatalogEntry[]>(assetUrl("data/catalog.json.gz"), abort.signal)
      .then(setCatalog)
      .catch((e) => {
        if (e.name !== "AbortError") setCatalogError(true);
      });
    return () => abort.abort();
  }, [retry]);
  const catalogById = useMemo(
    () => new Map(catalog.map((entry) => [entry.id, entry])),
    [catalog],
  );
  const catalogIndex = useMemo(() => createCatalogIndex(catalog), [catalog]);
  const selected = catalogById.get(route.id);
  useEffect(() => {
    if (!selected || !selected.dataPath || route.screen !== "read") return;
    const abort = new AbortController();
    setBook(null);
    setBookError("");
    if (bookCache.current.has(selected.id)) {
      setBook(bookCache.current.get(selected.id)!);
      return;
    }
    fetchJson<Book>(assetUrl(selected.dataPath), abort.signal)
      .then((data: Book) => {
        if (abort.signal.aborted) return;
        if (
          data.id !== selected.id ||
          data.contentVersion !== selected.contentVersion ||
          data.schemaVersion !== 1 ||
          !Array.isArray(data.blocks) ||
          !data.blocks.length
        )
          throw new Error();
        bookCache.current.set(data.id, data);
        if (bookCache.current.size > 3)
          bookCache.current.delete(bookCache.current.keys().next().value!);
        setBook(data);
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setBookError(
            "作品を読み込めませんでした。通信環境を確認して、もう一度お試しください。",
          );
      });
    return () => abort.abort();
  }, [selected?.id, retry, route.screen]);
  const updateSettings = useCallback((value: ReaderSettings) => {
    setSettings(value);
    if (!readerStorage.saveSettings(value))
      setSaveWarning("この環境では読書位置・設定を保存できません。");
  }, []);
  const updateRecord = useCallback((id: string, record: ReadingRecord) => {
    if (!readerStorage.saveRecord(id, record))
      setSaveWarning("この環境では読書位置・設定を保存できません。");
    setRecordVersion((v) => v + 1);
  }, []);
  const recent = useMemo(
    () =>
      readerStorage
        .getRecentRecords(20)
        .filter((item) => catalogById.get(item.bookId)?.dataPath),
    [catalogById, recordVersion],
  );
  const resume = recent[0] && catalogById.get(recent[0].bookId);
  const featured =
    catalog.find((b) => b.title === "吾輩は猫である") || catalog[0];
  const authors = useMemo(() => {
    const names = new Map<string, string>();
    for (const entry of catalog)
      for (const person of entry.authors)
        if (!names.has(person.name))
          names.set(person.name, person.kana || person.name);
    return [...names.keys()].sort((a, b) =>
      names.get(a)!.localeCompare(names.get(b)!, "ja"),
    );
  }, [catalog]);
  const hasSearchConditions = Boolean(
    query.trim() || author || filter !== "all",
  );
  const clearSearch = () => {
    setQuery("");
    setAuthor("");
    setFilter("all");
    searchRef.current?.focus({ preventScroll: true });
  };
  const visible = useMemo(
    () =>
      catalogIndex
        .search(deferredQuery, sort)
        .filter(
          (b) =>
            (!author || b.authors.some((person) => person.name === author)) &&
            (filter === "short"
              ? Boolean(b.dataPath) && b.characterCount < 30000
              : filter === "long"
                ? Boolean(b.dataPath) && b.characterCount >= 30000
                : filter === "recent"
                  ? recent.some((r) => r.bookId === b.id)
                  : true),
        ),
    [catalogIndex, deferredQuery, sort, author, filter, recent],
  );
  useEffect(() => setShelfPage(1), [deferredQuery, sort, author, filter]);
  const pageCount = Math.max(1, Math.ceil(visible.length / CATALOG_PAGE_SIZE));
  const currentPage = Math.min(shelfPage, pageCount);
  const pageStart = (currentPage - 1) * CATALOG_PAGE_SIZE;
  const pageBooks = visible.slice(pageStart, pageStart + CATALOG_PAGE_SIZE);
  const changeShelfPage = (page: number) => {
    setShelfPage(page);
    document
      .getElementById("catalog-results")
      ?.scrollIntoView({ block: "start" });
  };
  const openRead = (id: string) => {
    navigate(`/read/${id}`);
  };
  const isReader = route.screen === "read";
  const clear = () => {
    const cleared = readerStorage.clear();
    setSettings(defaultSettings);
    setRecordVersion((v) => v + 1);
    notify(
      cleared
        ? "端末内の読書データを削除しました"
        : "この読書中のデータを消去しました。ブラウザの保存データは設定から削除してください。",
    );
  };
  return (
    <>
      <a
        href="#main-content"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        本文へ移動
      </a>
      {!isReader && (
        <header className="site-header">
          <div className="header-inner">
            <Brand />
            <nav aria-label="メインナビゲーション">
              <a className="active" href="#/">
                本棚
              </a>
              <button
                onClick={() => {
                  if (resume) openRead(resume.id);
                  else notify("作品を読むと、ここから続きに戻れます");
                }}
              >
                読書のつづき
              </button>
              <button onClick={() => setAbout(true)}>この文庫について</button>
            </nav>
            <span className="header-note">いつでも、好きな読み方で。</span>
          </div>
        </header>
      )}
      {isReader ? (
        selected ? (
          !selected.dataPath ? (
            <main id="main-content" tabIndex={-1} className="loading-view">
              <Info size={32} />
              <h1>{displayTitle(selected.title)}</h1>
              <p>{selected.authorLabel}</p>
              <p>
                {selected.unavailableReason ||
                  "この作品の本文は公式図書カードからご確認ください。"}
              </p>
              <a
                className="button primary"
                href={selected.cardUrl}
                target="_blank"
                rel="noreferrer"
              >
                青空文庫の図書カード <ExternalLink size={16} />
              </a>
              <a className="text-link" href="#/">
                本棚に戻る
              </a>
            </main>
          ) : book?.id === selected.id ? (
            <ReaderBoundary key={book.id}>
              <ReadingView
                key={book.id}
                book={book}
                settings={settings}
                onSettings={updateSettings}
                onSave={updateRecord}
                onAbout={() => setAbout(true)}
                onNotify={notify}
                storageVersion={recordVersion}
              />
            </ReaderBoundary>
          ) : (
            <main id="main-content" tabIndex={-1} className="loading-view">
              {bookError ? (
                <>
                  <Info size={32} />
                  <h1>作品の読み込みに失敗しました</h1>
                  <p>{bookError}</p>
                  <button
                    className="button primary"
                    onClick={() => setRetry((v) => v + 1)}
                  >
                    もう一度読み込む
                  </button>
                  <a href="#/" className="text-link">
                    本棚に戻る
                  </a>
                </>
              ) : (
                <>
                  <LoaderCircle className="spin" size={28} />
                  <p>本を開いています</p>
                  <a href="#/" className="text-link">
                    本棚に戻る
                  </a>
                </>
              )}
            </main>
          )
        ) : (
          <main className="loading-view" id="main-content" tabIndex={-1}>
            {catalogError ? (
              <>
                <Info size={30} />
                <h1>本棚を読み込めませんでした</h1>
                <button
                  className="button primary"
                  onClick={() => setRetry((v) => v + 1)}
                >
                  再試行
                </button>
                <a className="text-link" href="#/">
                  本棚に戻る
                </a>
              </>
            ) : catalog.length ? (
              <>
                <h1>この作品は本棚にありません</h1>
                <a className="button primary" href="#/">
                  本棚に戻る
                </a>
              </>
            ) : (
              <>
                <LoaderCircle className="spin" />
                <p>本棚を読み込んでいます</p>
              </>
            )}
          </main>
        )
      ) : (
        <main id="main-content" tabIndex={-1} className="library-main">
          <h1 className="sr-only">Aozora Stone Reader</h1>
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">
                <span /> A LITTLE LIBRARY, A QUIET MOMENT
              </span>
              <p>
                stone-engine.jsを組版エンジンに採用した、
                <br />
                縦書き・横書き対応の青空文庫リーダーです。
                <br />
                禁則処理や二桁数字の縦中横にも対応。
              </p>
              <a
                className="button primary"
                href="#collection"
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById("collection")
                    ?.scrollIntoView({ behavior: "smooth" });
                  searchRef.current?.focus({ preventScroll: true });
                }}
              >
                作品を探す <Search size={16} />
              </a>
              <div className="hero-detail">
                <span>
                  <BookOpen size={15} />
                  {catalog.length
                    ? `${catalog.length.toLocaleString()}作品の文庫`
                    : "青空文庫の小さな文庫"}
                </span>
                <span>
                  <Type size={15} /> 縦書き・横書き対応
                </span>
              </div>
            </div>
            <div className="hero-books" aria-label="文庫の作品">
              {catalog.length > 0 && (
                <>
                  <div className="hero-book back">
                    <BookCover
                      book={
                        catalog.find((b) => b.title === "檸檬") || catalog[1]
                      }
                      index={5}
                    />
                  </div>
                  <div className="hero-book front">
                    <button
                      aria-label={`${displayTitle(featured.title)}を読む`}
                      onClick={() => openRead(featured.id)}
                    >
                      <BookCover book={featured} index={0} />
                    </button>
                  </div>
                  <div className="hero-book side">
                    <BookCover
                      book={
                        catalog.find((b) => b.title === "銀河鉄道の夜") ||
                        catalog[2]
                      }
                      index={2}
                    />
                  </div>
                  <div className="hero-caption">
                    <span className="caption-line" />
                    <p>
                      言葉の余白に、
                      <br />
                      心をほどく。
                    </p>
                  </div>
                </>
              )}
              <span className="hero-circle" />
            </div>
          </section>
          {resume && (
            <section className="resume-strip">
              <div className="resume-icon">
                <BookOpen size={21} />
              </div>
              <div>
                <span className="eyebrow">CONTINUE READING</span>
                <h2>
                  {displayTitle(resume.title)}
                  <span>{resume.authorLabel}</span>
                </h2>
              </div>
              <div className="resume-progress">
                <div>
                  <i style={{ width: `${recent[0].record.progress * 100}%` }} />
                </div>
                <span>{Math.round(recent[0].record.progress * 100)}% 読了</span>
              </div>
              <button className="text-link" onClick={() => openRead(resume.id)}>
                続きから読む <ArrowRight size={17} />
              </button>
            </section>
          )}
          <section className="collection" id="collection">
            <div className="collection-heading">
              <div>
                <span className="eyebrow">THE COLLECTION</span>
                <h2 className="serif">
                  本棚<span>{catalog.length}冊</span>
                </h2>
              </div>
            </div>
            <div className="collection-tools">
              <div
                className="search-sort"
                role="search"
                aria-label="収録作品を検索"
              >
                <div className="search-field">
                  <Search size={19} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    type="search"
                    aria-label="作品名・作家名で検索"
                    aria-describedby="catalog-search-help"
                    aria-controls="catalog-results"
                    placeholder="作品名・作家名・読みで探す"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="検索語を消す"
                      onClick={() => {
                        setQuery("");
                        searchRef.current?.focus();
                      }}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <label className="author-field">
                  <span className="sr-only">作家で絞り込み</span>
                  <select
                    aria-label="作家で絞り込み"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    aria-controls="catalog-results"
                  >
                    <option value="">すべての作家</option>
                    {authors.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </label>
              </div>
              <p className="search-help" id="catalog-search-help">
                作品名・作家名・読みで検索できます。空白で区切ると、すべての言葉を含む作品を探せます。
              </p>
              <div className="collection-filters">
                <div className="filter-tabs" aria-label="作品の絞り込み">
                  {[
                    ["all", "すべて"],
                    ["short", "短編"],
                    ["long", "長編"],
                    ["recent", "最近読んだ本"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={filter === value ? "selected" : ""}
                      aria-pressed={filter === value}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="sort-field">
                  <select
                    aria-label="並べ替え"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as CatalogSort)}
                  >
                    <option value="recommended">おすすめ順</option>
                    <option value="title">作品名順</option>
                    <option value="author">作家名順</option>
                  </select>
                  <ChevronDown size={14} />
                </label>
              </div>
            </div>
            {catalog.length > 0 && !catalogError && (
              <div className="collection-summary">
                <p
                  className="collection-results"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {visible.length} / {catalog.length}作品
                </p>
                {hasSearchConditions && (
                  <button className="text-link" onClick={clearSearch}>
                    <X size={14} /> 検索条件をクリア
                  </button>
                )}
              </div>
            )}
            <div id="catalog-results">
              {catalogError ? (
                <div className="empty-state">
                  <Info />
                  <h3>本棚を読み込めませんでした</h3>
                  <button
                    className="button"
                    onClick={() => setRetry((v) => v + 1)}
                  >
                    再試行
                  </button>
                </div>
              ) : !catalog.length ? (
                <div className="empty-state">
                  <LoaderCircle className="spin" />
                  <p>本棚を準備しています</p>
                </div>
              ) : !visible.length ? (
                <div className="empty-state">
                  <Search />
                  <h3>
                    {filter === "recent" && !query.trim() && !author
                      ? "読書の記録はこれから。"
                      : "お探しの作品が見つかりませんでした"}
                  </h3>
                  <p>
                    {filter === "recent" && !query.trim() && !author
                      ? "気になる一冊を開いてみてください。"
                      : "検索語や作家、短編・長編の条件を変えてお試しください。"}
                  </p>
                  <button className="button" onClick={clearSearch}>
                    すべての作品を見る
                  </button>
                </div>
              ) : (
                <div className="book-grid">
                  {pageBooks.map((b) => {
                    const index = Number(b.id) % palettes.length;
                    const record = readerStorage.getRecord(b.id);
                    return (
                      <article className="book-card" key={b.id}>
                        <button
                          className="book-cover-button"
                          onClick={() => openRead(b.id)}
                          aria-label={`${displayTitle(b.title)}${b.dataPath ? "を読む" : "の作品情報"}`}
                        >
                          <BookCover book={b} index={index} />
                          <span className="cover-open">
                            <BookOpen size={17} />
                            {b.dataPath ? "読む" : "作品情報"}
                          </span>
                        </button>
                        <div className="book-card-copy">
                          <div className="card-category">
                            <span>
                              {!b.dataPath
                                ? "公式図書カードへ"
                                : b.characterCount >= 30000
                                  ? "長編"
                                  : "短編"}
                            </span>
                            <span>
                              <Clock3 size={12} />
                              {b.dataPath
                                ? formatMinutes(b.characterCount)
                                : "本文未収録"}
                            </span>
                          </div>
                          <h3>
                            <a href={`#/read/${b.id}`}>
                              {displayTitle(b.title)}
                            </a>
                          </h3>
                          <p>{b.authorLabel}</p>
                          {(b.subtitle || b.orthography) && (
                            <p className="book-edition">
                              {[b.subtitle, b.orthography]
                                .filter(Boolean)
                                .join(" ／ ")}
                            </p>
                          )}
                          {record && (
                            <button
                              className="card-resume"
                              onClick={() => openRead(b.id)}
                            >
                              <span>続きから</span>
                              <span>
                                {Math.round(record.progress * 100)}%{" "}
                                <ArrowRight size={13} />
                              </span>
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
            {visible.length > 0 && (
              <nav className="catalog-pagination" aria-label="本棚のページ">
                <button
                  className="button"
                  disabled={currentPage === 1}
                  onClick={() => changeShelfPage(currentPage - 1)}
                >
                  <ChevronLeft size={16} /> 前の40作品
                </button>
                <div>
                  <span role="status" aria-live="polite">
                    {pageStart + 1}–
                    {Math.min(pageStart + CATALOG_PAGE_SIZE, visible.length)} /{" "}
                    {visible.length.toLocaleString()}作品
                  </span>
                  <label>
                    ページ
                    <input
                      aria-label="本棚のページ番号"
                      type="number"
                      min={1}
                      max={pageCount}
                      value={currentPage}
                      onChange={(event) => {
                        const page = Number(event.target.value);
                        if (
                          Number.isInteger(page) &&
                          page >= 1 &&
                          page <= pageCount
                        )
                          setShelfPage(page);
                      }}
                    />
                    / {pageCount}
                  </label>
                </div>
                <button
                  className="button"
                  disabled={currentPage === pageCount}
                  onClick={() => changeShelfPage(currentPage + 1)}
                >
                  次の40作品 <ChevronRight size={16} />
                </button>
              </nav>
            )}
            <p className="collection-footnote">
              著作権切れの公開作品を収録しています。本文未収録の作品は公式図書カードへご案内します。読書時間は1分500文字での目安です。
            </p>
          </section>
          <section className="library-note">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
            </span>
            <p className="serif">
              変わらない物語に、
              <br className="mobile-break" />
              新しい読み心地を。
            </p>
            <p>
              日本語のための組版エンジン stone-engine.js で、
              <br />
              句読点からルビまで、一文字ずつ丁寧に。
            </p>
            <button className="text-link" onClick={() => setAbout(true)}>
              この文庫について <ArrowRight size={15} />
            </button>
          </section>
        </main>
      )}
      {!isReader && (
        <footer className="site-footer">
          <Brand compact />
          <span>青空文庫の文学を、あなたのそばに。</span>
          <button onClick={() => setAbout(true)}>
            出典とライセンス <ExternalLink size={12} />
          </button>
        </footer>
      )}
      {about && (
        <About
          onClose={() => setAbout(false)}
          onClear={clear}
          bookCount={catalog.length}
          sourceOnlyCount={catalog.filter((entry) => !entry.dataPath).length}
        />
      )}
      {saveWarning && (
        <div className="save-warning" role="status">
          <Info size={16} />
          {saveWarning}
          <button aria-label="通知を閉じる" onClick={() => setSaveWarning("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </>
  );
}

function ReadingView({
  book,
  settings,
  onSettings,
  onSave,
  onAbout,
  onNotify,
  storageVersion,
}: {
  book: Book;
  settings: ReaderSettings;
  onSettings: (s: ReaderSettings) => void;
  onSave: (id: string, record: ReadingRecord) => void;
  onAbout: () => void;
  onNotify: (s: string) => void;
  storageVersion: number;
}) {
  const initial = useRef<{ anchor: Anchor; adjusted: boolean } | null>(null);
  if (!initial.current) {
    const previous = readerStorage.getRecord(book.id);
    initial.current = previous
      ? restoreAnchor(book, previous.anchor, previous.contentVersion)
      : { anchor: createAnchor(book, book.blocks[0].id, 0), adjusted: false };
  }
  const [anchor, setAnchor] = useState<Anchor>(initial.current.anchor);
  const [panel, setPanel] = useState<"toc" | "bookmarks" | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const info = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const cssMode = settings.renderingMode === "css";
  const cssReader = useRef<CssReaderHandle>(null);
  const [cssLocation, setCssLocation] = useState<CssReaderLocation | null>(
    null,
  );
  const onCssLocationChange = useCallback((location: CssReaderLocation) => {
    setCssLocation(location);
    if (location.page) {
      const start = location.page.start;
      setAnchor((current) =>
        current.blockId === start.blockId && current.offset === start.offset
          ? current
          : start,
      );
    }
  }, []);
  useEffect(() => {
    if (!cssMode) setCssLocation(null);
  }, [cssMode]);
  const [landscape, setLandscape] = useState(
    () =>
      window.matchMedia("(min-width: 800px) and (orientation: landscape)")
        .matches,
  );
  const spread =
    !cssMode &&
    settings.pageLayout === "spread" &&
    landscape &&
    size.width >= 600;
  const pageCount = spread ? 2 : 1;
  const pageWidth = spread ? Math.floor((size.width - 24) / 2) : size.width;
  const viewport = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const wheel = useRef({ distance: 0, lastEventAt: 0, lastTurnAt: -Infinity });
  const lastSaved = useRef("");
  const migratedBookmarks = useRef(false);
  const stone = usePagination({
    book,
    settings,
    width: pageWidth,
    height: size.height,
    anchor,
    pageCount,
    enabled: !cssMode,
  });
  const page = cssMode ? (cssLocation?.page ?? null) : stone.page;
  const pages = stone.pages;
  const loading = cssMode ? (cssLocation?.loading ?? true) : stone.loading;
  const error = cssMode ? (cssLocation?.error ?? null) : stone.error;
  const nextAnchor = cssMode
    ? cssLocation?.hasNext
      ? (page?.end ?? null)
      : null
    : stone.nextAnchor;
  const previousAnchor = cssMode
    ? cssLocation?.hasPrevious
      ? (page?.start ?? null)
      : null
    : stone.previousAnchor;
  const progress = cssMode ? (cssLocation?.progress ?? 0) : stone.progress;
  const isEnd = cssMode ? (cssLocation?.isEnd ?? false) : stone.isEnd;
  const preload = stone.preload;
  const retryLayout = useCallback(() => {
    if (cssMode) cssReader.current?.retry();
    else stone.retry();
  }, [cssMode, stone.retry]);
  const record = readerStorage.getRecord(book.id);
  const bookmarks = record?.bookmarks || [];
  const vertical = settings.direction === "tbRl";
  useEffect(() => {
    const query = window.matchMedia(
      "(min-width: 800px) and (orientation: landscape)",
    );
    const update = () => setLandscape(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (infoOpen)
      info.current?.querySelector<HTMLElement>('[role="region"]')?.focus();
  }, [infoOpen]);
  useEffect(() => {
    if (initial.current?.adjusted)
      onNotify("作品データの更新により読書位置を調整しました");
  }, []);
  useEffect(() => {
    if (migratedBookmarks.current) return;
    migratedBookmarks.current = true;
    const previous = readerStorage.getRecord(book.id);
    if (!previous || previous.contentVersion === book.contentVersion) return;
    let adjusted = false;
    const bookmarks = previous.bookmarks.map((bookmark) => {
      const result = restoreAnchor(
        book,
        bookmark.anchor,
        previous.contentVersion,
      );
      if (result.adjusted) adjusted = true;
      return { ...bookmark, anchor: result.anchor };
    });
    onSave(book.id, {
      ...previous,
      contentVersion: book.contentVersion,
      anchor: initial.current!.anchor,
      bookmarks,
    });
    if (adjusted)
      onNotify("作品データの更新により、しおりの位置を調整しました");
  }, [book, onSave, onNotify]);
  useLayoutEffect(() => {
    const element = viewport.current!;
    const update = (rect: { width: number; height: number }) => {
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    update(element.getBoundingClientRect());
    const observer = new ResizeObserver((entries) => {
      update(entries[0].contentRect);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!page || loading) return;
    const key = `${book.id}:${page.start.blockId}:${page.start.offset}:${isEnd}`;
    if (lastSaved.current === key) return;
    lastSaved.current = key;
    const previous = readerStorage.getRecord(book.id);
    onSave(book.id, {
      contentVersion: book.contentVersion,
      anchor: page.start,
      updatedAt: new Date().toISOString(),
      progress: isEnd ? 1 : anchorProgress(book, page.start),
      bookmarks: previous?.bookmarks || [],
    });
  }, [page, loading, isEnd, book, onSave]);
  const advance = useCallback(
    (next: boolean) => {
      if (loading || panel) return;
      if (cssMode) {
        cssReader.current?.advance(next);
        return;
      }
      const target = next ? nextAnchor : previousAnchor;
      if (target) setAnchor(target);
    },
    [loading, panel, cssMode, nextAnchor, previousAnchor],
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        panel ||
        document.querySelector("dialog[open]") ||
        (event.target as HTMLElement).closest(
          ".reader-settings,.reader-work-info,input,select,textarea,button,a,[contenteditable]",
        )
      )
        return;
      let forward: boolean | undefined;
      if (event.key === "ArrowLeft") forward = vertical;
      if (event.key === "ArrowRight") forward = !vertical;
      if (event.key === "PageDown") forward = true;
      if (event.key === "PageUp") forward = false;
      if (event.code === "Space") forward = !event.shiftKey;
      if (forward !== undefined) {
        event.preventDefault();
        advance(forward);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [advance, panel, vertical]);
  useEffect(() => {
    const element = viewport.current!;
    const state = wheel.current;
    state.distance = 0;
    const handler = (event: WheelEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        panel ||
        document.querySelector("dialog[open]") ||
        (event.target instanceof Element &&
          event.target.closest(
            "input,select,textarea,button,a,[contenteditable]",
          ))
      ) {
        state.distance = 0;
        return;
      }
      if (
        !Number.isFinite(event.deltaY) ||
        event.deltaY === 0 ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return;
      // A wheel turn pages the reading viewport; it must not also scroll its ancestors.
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      if (loading || error || !page) {
        state.distance = 0;
        return;
      }
      // Wheel deltas can use pixels, lines or whole pages, depending on the device.
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? Math.max(40, settings.fontSize * settings.lineHeight)
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? element.clientHeight
            : 1;
      const distance = event.deltaY * unit;
      if (
        now - state.lastEventAt > 180 ||
        Math.sign(state.distance) !== Math.sign(distance)
      )
        state.distance = 0;
      state.lastEventAt = now;
      // Discard momentum during the cooldown rather than queueing additional pages.
      if (now - state.lastTurnAt < 300) {
        state.distance = 0;
        return;
      }
      state.distance += distance;
      if (Math.abs(state.distance) < 40) return;
      const forward = state.distance > 0;
      state.distance = 0;
      if (!(forward ? nextAnchor : previousAnchor)) return;
      state.lastTurnAt = now;
      advance(forward);
    };
    element.addEventListener("wheel", handler, { passive: false });
    return () => element.removeEventListener("wheel", handler);
  }, [
    advance,
    panel,
    loading,
    error,
    page,
    nextAnchor,
    previousAnchor,
    settings.fontSize,
    settings.lineHeight,
  ]);
  const addBookmark = () => {
    if (!page) return;
    const current = readerStorage.getRecord(book.id) || {
      contentVersion: book.contentVersion,
      anchor: page.start,
      updatedAt: new Date().toISOString(),
      progress: isEnd ? 1 : anchorProgress(book, page.start),
      bookmarks: [],
    };
    if (
      current.bookmarks.some(
        (b) =>
          b.anchor.blockId === page.start.blockId &&
          b.anchor.offset === page.start.offset,
      )
    ) {
      onNotify("このページには、しおりが挟まれています");
      return;
    }
    onSave(book.id, {
      ...current,
      bookmarks: [
        ...current.bookmarks,
        {
          id: crypto.randomUUID(),
          anchor: page.start,
          createdAt: new Date().toISOString(),
          excerpt: page.text.replace(/\n/g, "").slice(0, 45),
        },
      ],
    });
    onNotify("しおりを挟みました");
  };
  const removeBookmark = (id: string) => {
    const current = readerStorage.getRecord(book.id);
    if (!current) return;
    const remaining = current.bookmarks.filter((b) => b.id !== id);
    onSave(book.id, {
      ...current,
      bookmarks: remaining,
    });
    if (!remaining.length) setPanel(null);
  };
  const hasBookmark =
    page &&
    bookmarks.some(
      (b) =>
        b.anchor.blockId === page.start.blockId &&
        b.anchor.offset === page.start.offset,
    );
  const openInfo = () => {
    setPanel(null);
    setSettingsOpen(false);
    setInfoOpen(true);
  };
  const next = (
    <button
      className="page-nav next"
      onClick={() => advance(true)}
      disabled={!nextAnchor || loading}
      aria-label="次のページ"
    >
      <span>次へ</span>
      {vertical ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
  );
  const previous = (
    <button
      className="page-nav previous"
      onClick={() => advance(false)}
      disabled={!previousAnchor || loading}
      aria-label="前のページ"
    >
      {vertical ? <ChevronRight size={22} /> : <ChevronLeft size={22} />}
      <span>前へ</span>
    </button>
  );
  return (
    <div
      className={`reader-shell ${vertical ? "vertical" : "horizontal"}`}
      data-testid="reader"
      data-engine={settings.renderingMode}
    >
      <header className="reader-header">
        <a href="#/" className="reader-back" aria-label="本棚へ">
          <ArrowLeft size={19} />
          <span>本棚へ</span>
        </a>
        <div className="reader-title">
          <strong>{displayTitle(book.title)}</strong>
          <span>{book.authorLabel}</span>
        </div>
        <div className="reader-header-actions">
          <div
            className="direction-toggle page-layout-toggle"
            role="group"
            aria-label="ページ表示"
            hidden={cssMode}
          >
            <button
              aria-label="1ページ表示に切り替え"
              aria-pressed={settings.pageLayout === "single"}
              onClick={() => onSettings({ ...settings, pageLayout: "single" })}
            >
              1ページ
            </button>
            <button
              aria-label="見開き表示に切り替え"
              aria-pressed={settings.pageLayout === "spread"}
              onClick={() => onSettings({ ...settings, pageLayout: "spread" })}
            >
              見開き
            </button>
          </div>
          <div className="direction-toggle">
            <button
              aria-label="縦書きに切り替え"
              aria-pressed={vertical}
              onClick={() => onSettings({ ...settings, direction: "tbRl" })}
            >
              縦
            </button>
            <button
              aria-label="横書きに切り替え"
              aria-pressed={!vertical}
              onClick={() => onSettings({ ...settings, direction: "lrTb" })}
            >
              横
            </button>
          </div>
          <ReaderThemeToggle settings={settings} onChange={onSettings} />
          <div className="reader-bookmark-controls">
            <button
              className={`bookmark-add ${hasBookmark ? "marked" : ""}`}
              aria-label="このページにしおりを挟む"
              aria-description={
                hasBookmark ? "このページにはしおりがあります" : undefined
              }
              title={
                hasBookmark
                  ? "このページにはしおりがあります"
                  : "このページにしおりを挟む"
              }
              onClick={addBookmark}
              disabled={!page || loading}
            >
              <BookmarkIcon
                size={19}
                fill={hasBookmark ? "currentColor" : "none"}
                aria-hidden="true"
              />
              <span>しおり</span>
            </button>
            {bookmarks.length > 0 && (
              <button
                className="bookmark-list-toggle"
                aria-label="しおり一覧を開く"
                title="しおり一覧を開く"
                onClick={() => setPanel("bookmarks")}
              >
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            className="reader-info-toggle"
            aria-label={infoOpen ? "作品情報を閉じる" : "作品情報を開く"}
            aria-expanded={infoOpen}
            aria-controls="reader-work-info"
            onClick={() => (infoOpen ? setInfoOpen(false) : openInfo())}
          >
            <Info size={19} aria-hidden="true" />
            <span className="reader-info-label">作品情報</span>
            <span className="reader-work-info-facts">
              {formatMinutes(book.characterCount)} ·{" "}
              {book.characterCount.toLocaleString()}文字
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="reader-workspace">
        <main id="main-content" tabIndex={-1} className="reader-main">
          <div
            ref={info}
            id="reader-work-info"
            className="reader-work-info"
            hidden={!infoOpen}
          >
            <WorkDetails
              book={book}
              onRestart={() => {
                setAnchor(createAnchor(book, book.blocks[0].id, 0));
                setInfoOpen(false);
              }}
            />
          </div>
          <div
            className="reader-viewport"
            ref={viewport}
            data-testid="reader-viewport"
            onPointerDown={(event) => {
              if (cssMode) return;
              if (event.pointerType === "touch")
                pointer.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerUp={(event) => {
              if (cssMode) return;
              if (!pointer.current || window.getSelection()?.toString()) {
                pointer.current = null;
                return;
              }
              const dx = event.clientX - pointer.current.x,
                dy = event.clientY - pointer.current.y;
              pointer.current = null;
              if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.5)
                advance(vertical ? dx > 0 : dx < 0);
            }}
            onPointerCancel={() => {
              pointer.current = null;
            }}
          >
            {cssMode ? (
              <div
                className="reader-page-wrap"
                data-testid="reader-page"
                data-block={page?.start.blockId}
                data-offset={page?.start.offset}
                data-start={page?.globalStart}
                data-end={page?.globalEnd}
                data-layout="single"
              >
                <CssReader
                  ref={cssReader}
                  book={book}
                  settings={settings}
                  width={size.width}
                  height={size.height}
                  anchor={anchor}
                  onLocationChange={onCssLocationChange}
                />
              </div>
            ) : (
              page && (
                <div
                  className="reader-page-wrap"
                  data-testid="reader-page"
                  data-block={page.start.blockId}
                  data-offset={page.start.offset}
                  data-start={page.globalStart}
                  data-end={pages[pages.length - 1].globalEnd}
                  data-layout={spread ? "spread" : "single"}
                >
                  <Suspense
                    fallback={<span role="status">本文を読み込んでいます</span>}
                  >
                    <ReaderPages
                      pages={pages}
                      settings={settings}
                      spread={spread}
                    />
                  </Suspense>
                </div>
              )
            )}
            {loading && (
              <div
                className={`reader-loading ${page ? "subtle" : ""}`}
                role="status"
              >
                <LoaderCircle className="spin" size={25} />
                <span>文字を整えています</span>
              </div>
            )}
            {error && (
              <div className="reader-error" role="alert">
                <Info />
                <p>{error}</p>
                <button className="button" onClick={retryLayout}>
                  再試行
                </button>
                <a
                  className="external-link"
                  href={book.cardUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  青空文庫で原文を開く <ExternalLink size={14} />
                </a>
              </div>
            )}
          </div>
          <div className="reader-page-bottom">
            <span className="reader-end">
              {cssMode && (
                <span className="reader-engine-status">
                  CSS · ライブラリ未使用
                </span>
              )}
              {isEnd ? (
                <>
                  <Check size={14} />
                  読み終わり{" "}
                  <button className="text-link" onClick={openInfo}>
                    底本・制作情報
                  </button>
                </>
              ) : !cssMode && settings.paginationMode === "on-demand" ? (
                "言葉のつづきへ。"
              ) : null}
              {!cssMode && settings.paginationMode !== "on-demand" && (
                <span
                  className="reader-preload-status"
                  data-testid="pagination-preload"
                  data-mode={settings.paginationMode}
                  data-state={preload?.state ?? "running"}
                  data-pages={preload?.preparedPages ?? 0}
                  title={preload?.error ?? undefined}
                >
                  {preload?.state === "error" ? (
                    <>
                      先読みを停止しました{" "}
                      <button className="text-link" onClick={retryLayout}>
                        再試行
                      </button>
                    </>
                  ) : settings.paginationMode === "all" ? (
                    preload?.state === "complete" ? (
                      `全${preload.preparedPages}ページ 組版済み`
                    ) : (
                      `全ページ組版中 · ${Math.floor((preload?.progress ?? 0) * 100)}%`
                    )
                  ) : preload?.state === "complete" ? (
                    `${preload.preparedPages}ページ先読み済み`
                  ) : (
                    `先読み中 · ${preload?.preparedPages ?? 0}/10ページ`
                  )}
                </span>
              )}
            </span>
            <span aria-live="polite">
              {Math.round((isEnd ? 1 : progress) * 100)}% 読了
            </span>
          </div>
        </main>
        <aside
          id="reader-settings-panel"
          className="reader-settings"
          aria-labelledby="reader-settings-title"
          hidden={!settingsOpen}
        >
          <div className="reader-settings-head">
            <div className="reader-settings-heading">
              <Settings2 size={17} aria-hidden="true" />
              <h2 id="reader-settings-title">読書の設定</h2>
            </div>
            <p>変更は本文にすぐ反映されます</p>
          </div>
          <div
            className="reader-settings-scroll"
            role="region"
            tabIndex={0}
            aria-label="読書設定の項目"
          >
            <SettingsPanel settings={settings} onChange={onSettings} />
          </div>
        </aside>
      </div>
      <footer className="reader-toolbar">
        <div className="reader-progress-line">
          <i style={{ width: `${(isEnd ? 1 : progress) * 100}%` }} />
        </div>
        <div className="toolbar-inner">
          <div className="toolbar-tools">
            <button
              className="toolbar-settings"
              aria-label={settingsOpen ? "読書設定を閉じる" : "読書設定を開く"}
              aria-expanded={settingsOpen}
              aria-controls="reader-settings-panel"
              onClick={() => {
                if (!settingsOpen) setInfoOpen(false);
                setSettingsOpen((open) => !open);
              }}
            >
              <Settings2 size={19} aria-hidden="true" />
              <span>設定</span>
            </button>
            <ReaderQuickControls
              settings={settings}
              onChange={onSettings}
              onOpen={() => {
                setPanel(null);
                setSettingsOpen(false);
                setInfoOpen(false);
              }}
            />
          </div>
          <div className="page-controls">
            {vertical ? next : previous}
            <span className="page-controls-divider" />
            {vertical ? previous : next}
          </div>
          {book.toc.length > 0 && (
            <button
              className="toolbar-toc"
              aria-label="目次を開く"
              onClick={() => setPanel("toc")}
            >
              <List size={19} aria-hidden="true" />
              <span>目次</span>
            </button>
          )}
        </div>
      </footer>
      {panel === "toc" && book.toc.length > 0 && (
        <Modal title="目次" onClose={() => setPanel(null)}>
          <div className="toc-list">
            <button
              onClick={() => {
                setAnchor(createAnchor(book, book.blocks[0].id, 0));
                setPanel(null);
              }}
            >
              <span>作品のはじめ</span>
              <ArrowRight size={16} />
            </button>
            {book.toc.map((item, i) => (
              <button
                key={`${item.blockId}-${i}`}
                className={item.level > 1 ? "subheading" : ""}
                onClick={() => {
                  setAnchor(createAnchor(book, item.blockId, 0));
                  setPanel(null);
                }}
              >
                <span>{item.title}</span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
          <button className="text-link" onClick={openInfo}>
            底本・制作情報を読む <Info size={14} />
          </button>
        </Modal>
      )}
      {panel === "bookmarks" && bookmarks.length > 0 && (
        <Modal title="挟んだしおり" onClose={() => setPanel(null)}>
          <div className="bookmark-list">
            {bookmarks.map((b) => (
              <div className="bookmark-item" key={b.id}>
                <button
                  className="bookmark-jump"
                  onClick={() => {
                    const restored = restoreAnchor(
                      book,
                      b.anchor,
                      record!.contentVersion,
                    );
                    setAnchor(restored.anchor);
                    setPanel(null);
                    if (restored.adjusted)
                      onNotify(
                        "作品データの更新により、しおりの位置を調整しました",
                      );
                  }}
                >
                  <BookmarkIcon size={16} />
                  <span>
                    <strong>{b.excerpt || "作品のはじめ"}</strong>
                    <small>
                      {new Date(b.createdAt).toLocaleDateString("ja-JP")} ·{" "}
                      {Math.round(anchorProgress(book, b.anchor) * 100)}%
                    </small>
                  </span>
                </button>
                <button
                  className="icon-button"
                  aria-label="しおりを削除"
                  onClick={() => removeBookmark(b.id)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      <button className="reader-about sr-only" onClick={onAbout}>
        この文庫について
      </button>
      <span className="sr-only">保存状態 {storageVersion}</span>
    </div>
  );
}
