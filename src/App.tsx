import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
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
  Moon,
  Search,
  Settings2,
  Sun,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { anchorProgress, createAnchor, restoreAnchor } from "./lib/anchors";
import { filterCatalog } from "./lib/catalog";
import { readerStorage } from "./lib/state";
import { ReaderPages, usePagination } from "./reader";
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
  return { screen: screen || "library", id: id || "" };
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
      aria-label="縦・横表示対応の青空文庫リーダー 本棚へ"
    >
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span>
        <strong>縦・横表示対応の青空文庫リーダー</strong>
        <small>AOZORA STONE READER</small>
      </span>
    </a>
  );
}

function BookCover({
  book,
  index = 0,
  large = false,
}: {
  book: CatalogEntry;
  index?: number;
  large?: boolean;
}) {
  return (
    <div
      className={`book-cover ${palettes[index % palettes.length]} ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      <span className="cover-edition">青空文庫</span>
      <span className="cover-line" />
      <span className="cover-title">{book.title}</span>
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
}: {
  onClose: () => void;
  onClear: () => void;
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
          初版は、著作権が消滅した20作品を収録しています。文字の大きさや行間を整えて、あなたに合う読み方を見つけてください。
        </p>
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

function WorkInfo({
  book,
  index,
  onClose,
  onRead,
  record,
}: {
  book: CatalogEntry | Book;
  index: number;
  onClose: () => void;
  onRead: (restart: boolean) => void;
  record?: ReadingRecord | null;
}) {
  const full = "blocks" in book ? book : null;
  const [showCredits, setShowCredits] = useState(false);
  return (
    <Modal title="作品情報" onClose={onClose} wide>
      <div className="work-info">
        <BookCover book={book} index={index} large />
        <div className="work-info-copy">
          <span className="eyebrow">
            AOZORA COLLECTION / {String(index + 1).padStart(2, "0")}
          </span>
          <h2 className="serif">{book.title}</h2>
          {book.subtitle && <p>{book.subtitle}</p>}
          <p className="work-author">{book.authorLabel}</p>
          <div className="work-facts">
            <span>
              <Clock3 size={15} /> {formatMinutes(book.characterCount)}
            </span>
            <span>{book.characterCount.toLocaleString()}文字</span>
          </div>
          <p className="work-excerpt">{book.excerpt}</p>
          <div className="button-stack">
            {record && (
              <button className="button primary" onClick={() => onRead(false)}>
                <BookOpen size={17} />
                続きから読む <span>{Math.round(record.progress * 100)}%</span>
              </button>
            )}
            <button
              className={`button ${record ? "" : "primary"}`}
              onClick={() => onRead(true)}
            >
              {record ? "最初から読む" : "この作品を読む"}
              <ArrowRight size={17} />
            </button>
          </div>
          <a
            className="external-link"
            href={book.cardUrl}
            target="_blank"
            rel="noreferrer"
          >
            青空文庫の図書カード <ExternalLink size={14} />
          </a>
          {full && (
            <>
              <button
                className="text-link"
                onClick={() => setShowCredits(!showCredits)}
              >
                底本・制作情報 <ChevronDown size={14} />
              </button>
              {showCredits && <pre className="credits">{full.credits}</pre>}
              {full.conversion.warnings.length > 0 && (
                <details className="conversion-details">
                  <summary>表示形式の変更について</summary>
                  <p>
                    原文の文字を保持し、以下の特殊な配置を読みやすい形式に整えています。
                  </p>
                  <ul>
                    {full.conversion.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
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
  return (
    <div className="settings-content">
      <div className="setting-group">
        <label htmlFor="page-layout">ページ表示</label>
        <select
          id="page-layout"
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
      <div className="typography-row">
        <div className="setting-group">
          <label htmlFor="writing-direction">文字方向</label>
          <select
            id="writing-direction"
            value={settings.direction}
            onChange={(event) =>
              set(
                "direction",
                event.target.value as ReaderSettings["direction"],
              )
            }
          >
            <option value="lrTb">横書き (lrTb)</option>
            <option value="tbRl">縦書き (tbRl)</option>
          </select>
        </div>
        <div className="setting-group">
          <label htmlFor="punctuation-mode">約物</label>
          <select
            id="punctuation-mode"
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
      <SettingRange
        id="font-size"
        label="フォントサイズ"
        min={10}
        max={48}
        step={1}
        value={settings.fontSize}
        display={`${settings.fontSize}px`}
        onChange={(value) => set("fontSize", value)}
      />
      <SettingRange
        id="line-height"
        label="行送り"
        min={1}
        max={3}
        step={0.05}
        value={settings.lineHeight}
        display={`×${settings.lineHeight.toFixed(2)}`}
        onChange={(value) => set("lineHeight", value)}
      />
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
              checked={settings[key]}
              onChange={(event) => set(key, event.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="setting-group">
        <label>配色</label>
        <div className="theme-options">
          {(["light", "paper", "dark"] as const).map((theme, i) => (
            <button
              key={theme}
              className={`theme-choice ${theme}`}
              aria-pressed={settings.theme === theme}
              onClick={() => set("theme", theme)}
            >
              {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
              <span>{["白", "生成り", "暗色"][i]}</span>
              {settings.theme === theme && <Check size={13} />}
            </button>
          ))}
        </div>
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
  const [sort, setSort] = useState<"title" | "author">("title");
  const [filter, setFilter] = useState("all");
  const [recordVersion, setRecordVersion] = useState(0);
  const [toast, setToast] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [bookError, setBookError] = useState("");
  const [retry, setRetry] = useState(0);
  const [restartId, setRestartId] = useState<string | null>(null);
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
      setRoute(getRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);
  useEffect(() => {
    const abort = new AbortController();
    setCatalogError(false);
    fetch(assetUrl("data/catalog.json"), { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setCatalog)
      .catch((e) => {
        if (e.name !== "AbortError") setCatalogError(true);
      });
    return () => abort.abort();
  }, [retry]);
  const selected = catalog.find((b) => b.id === route.id);
  useEffect(() => {
    if (!selected || !["read", "works"].includes(route.screen)) return;
    const abort = new AbortController();
    setBook(null);
    setBookError("");
    if (bookCache.current.has(selected.id)) {
      setBook(bookCache.current.get(selected.id)!);
      return;
    }
    fetch(assetUrl(selected.dataPath), { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data: Book) => {
        if (
          data.schemaVersion !== 1 ||
          !Array.isArray(data.blocks) ||
          !data.blocks.length
        )
          throw new Error();
        bookCache.current.set(data.id, data);
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
  const recent = readerStorage
    .getRecentRecords(20)
    .filter((item) => catalog.some((b) => b.id === item.bookId));
  const resume = recent[0] && catalog.find((b) => b.id === recent[0].bookId);
  const featured =
    catalog.find((b) => b.title === "吾輩は猫である") || catalog[0];
  const visible = filterCatalog(catalog, query, sort).filter((b) =>
    filter === "short"
      ? b.characterCount < 30000
      : filter === "long"
        ? b.characterCount >= 30000
        : filter === "recent"
          ? recent.some((r) => r.bookId === b.id)
          : true,
  );
  const openRead = (id: string, restart: boolean) => {
    setRestartId(restart ? id : null);
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
                  if (resume) openRead(resume.id, false);
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
          book ? (
            <ReaderBoundary key={book.id}>
              <ReadingView
                key={book.id}
                book={book}
                settings={settings}
                onSettings={updateSettings}
                onSave={updateRecord}
                restart={restartId === book.id}
                onRestartConsumed={() => setRestartId(null)}
                onAbout={() => setAbout(true)}
                onNotify={notify}
                storageVersion={recordVersion}
                index={catalog.indexOf(selected)}
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
          <h1 className="sr-only">縦・横表示対応の青空文庫リーダー</h1>
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">
                <span /> A LITTLE LIBRARY, A QUIET MOMENT
              </span>
              <p>
                青空文庫の名作を、心地よい文字組みで。
                <br />
                縦書きでも、横書きでも。あなたの好きな読み方で。
              </p>
              <a
                className="button primary"
                href="#collection"
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById("collection")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                本棚を眺める <ArrowDown size={16} />
              </a>
              <div className="hero-detail">
                <span>
                  <BookOpen size={15} /> {catalog.length || 20}作品の小さな文庫
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
                  <div
                    className="hero-book front"
                    onClick={() => navigate(`/works/${featured.id}`)}
                  >
                    <button aria-label={`${featured.title}の作品情報`}>
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
                  {resume.title}
                  <span>{resume.authorLabel}</span>
                </h2>
              </div>
              <div className="resume-progress">
                <div>
                  <i style={{ width: `${recent[0].record.progress * 100}%` }} />
                </div>
                <span>{Math.round(recent[0].record.progress * 100)}% 読了</span>
              </div>
              <button
                className="text-link"
                onClick={() => openRead(resume.id, false)}
              >
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
              <div className="search-sort">
                <label className="search-field">
                  <Search size={17} />
                  <input
                    type="search"
                    aria-label="作品名・作家名で検索"
                    placeholder="作品名・作家名で探す"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <label className="sort-field">
                  <select
                    aria-label="並べ替え"
                    value={sort}
                    onChange={(e) =>
                      setSort(e.target.value as "title" | "author")
                    }
                  >
                    <option value="title">作品名順</option>
                    <option value="author">作家名順</option>
                  </select>
                  <ChevronDown size={14} />
                </label>
              </div>
            </div>
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
                  {filter === "recent" && !query
                    ? "読書の記録はこれから。"
                    : "お探しの作品が見つかりませんでした"}
                </h3>
                <p>
                  {filter === "recent"
                    ? "気になる一冊を開いてみてください。"
                    : "作品名や作家名を変えてお試しください。"}
                </p>
                <button
                  className="button"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  すべての作品を見る
                </button>
              </div>
            ) : (
              <div className="book-grid">
                {visible.map((b) => {
                  const index = catalog.indexOf(b);
                  const record = readerStorage.getRecord(b.id);
                  return (
                    <article className="book-card" key={b.id}>
                      <button
                        className="book-cover-button"
                        onClick={() => navigate(`/works/${b.id}`)}
                        aria-label={`${b.title}の作品情報`}
                      >
                        <BookCover book={b} index={index} />
                        <span className="cover-open">
                          <BookOpen size={17} />
                          作品を開く
                        </span>
                      </button>
                      <div className="book-card-copy">
                        <div className="card-category">
                          <span>
                            {b.characterCount >= 30000 ? "長編" : "短編"}
                          </span>
                          <span>
                            <Clock3 size={12} />
                            {formatMinutes(b.characterCount)}
                          </span>
                        </div>
                        <h3>
                          <a href={`#/works/${b.id}`}>{b.title}</a>
                        </h3>
                        <p>{b.authorLabel}</p>
                        {record && (
                          <button
                            className="card-resume"
                            onClick={() => openRead(b.id, false)}
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
            <p className="collection-footnote">
              作品本文は青空文庫に基づきます。読書時間は1分500文字での目安です。
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
      {route.screen === "works" && selected && (
        <WorkInfo
          book={book || selected}
          index={catalog.indexOf(selected)}
          record={readerStorage.getRecord(selected.id)}
          onClose={() => navigate("/")}
          onRead={(restart) => openRead(selected.id, restart)}
        />
      )}
      {route.screen === "works" && catalog.length > 0 && !selected && (
        <Modal title="作品が見つかりません" onClose={() => navigate("/")}>
          <p>この作品は収録されていません。</p>
          <a className="button primary" href="#/">
            本棚に戻る
          </a>
        </Modal>
      )}
      {about && <About onClose={() => setAbout(false)} onClear={clear} />}
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
  restart,
  onRestartConsumed,
  onAbout,
  onNotify,
  storageVersion,
  index,
}: {
  book: Book;
  settings: ReaderSettings;
  onSettings: (s: ReaderSettings) => void;
  onSave: (id: string, record: ReadingRecord) => void;
  restart: boolean;
  onRestartConsumed: () => void;
  onAbout: () => void;
  onNotify: (s: string) => void;
  storageVersion: number;
  index: number;
}) {
  const initial = useRef<{ anchor: Anchor; adjusted: boolean } | null>(null);
  if (!initial.current) {
    const previous = restart ? null : readerStorage.getRecord(book.id);
    initial.current = previous
      ? restoreAnchor(book, previous.anchor, previous.contentVersion)
      : { anchor: createAnchor(book, book.blocks[0].id, 0), adjusted: false };
  }
  const [anchor, setAnchor] = useState<Anchor>(initial.current.anchor);
  const [panel, setPanel] = useState<"toc" | "bookmarks" | "info" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [landscape, setLandscape] = useState(
    () =>
      window.matchMedia("(min-width: 800px) and (orientation: landscape)")
        .matches,
  );
  const spread =
    settings.pageLayout === "spread" && landscape && size.width >= 600;
  const pageCount = spread ? 2 : 1;
  const pageWidth = spread ? Math.floor((size.width - 24) / 2) : size.width;
  const viewport = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const wheel = useRef({ distance: 0, lastEventAt: 0, lastTurnAt: -Infinity });
  const lastSaved = useRef("");
  const migratedBookmarks = useRef(false);
  const {
    page,
    pages,
    loading,
    error,
    nextAnchor,
    previousAnchor,
    progress,
    isEnd,
    retry: retryLayout,
  } = usePagination({
    book,
    settings,
    width: pageWidth,
    height: size.height,
    anchor,
    pageCount,
  });
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
    if (restart) onRestartConsumed();
  }, [restart, onRestartConsumed]);
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
      const target = next ? nextAnchor : previousAnchor;
      if (target) setAnchor(target);
    },
    [loading, panel, nextAnchor, previousAnchor],
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        panel ||
        document.querySelector("dialog[open]") ||
        (event.target as HTMLElement).closest(
          ".reader-settings,input,select,textarea,button,a,[contenteditable]",
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
    onSave(book.id, {
      ...current,
      bookmarks: current.bookmarks.filter((b) => b.id !== id),
    });
  };
  const hasBookmark =
    page &&
    bookmarks.some(
      (b) =>
        b.anchor.blockId === page.start.blockId &&
        b.anchor.offset === page.start.offset,
    );
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
    >
      <header className="reader-header">
        <a href="#/" className="reader-back" aria-label="本棚へ">
          <ArrowLeft size={19} />
          <span>本棚へ</span>
        </a>
        <div className="reader-title">
          <strong>{book.title}</strong>
          <span>{book.authorLabel}</span>
        </div>
        <div className="reader-header-actions">
          <div
            className="direction-toggle page-layout-toggle"
            role="group"
            aria-label="ページ表示"
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
          <button
            className="icon-button desktop-info"
            aria-label="作品情報"
            onClick={() => setPanel("info")}
          >
            <Info size={19} />
          </button>
        </div>
      </header>
      <div className="reader-workspace">
        <main id="main-content" tabIndex={-1} className="reader-main">
          <div className="reader-running-head">
            <span>
              {vertical ? "縦書き" : "横書き"} /{" "}
              {
                japaneseFontOptions.find(
                  ([value]) => value === settings.font,
                )?.[1]
              }
            </span>
            <span>AOZORA COLLECTION {String(index + 1).padStart(2, "0")}</span>
          </div>
          <div
            className="reader-viewport"
            ref={viewport}
            data-testid="reader-viewport"
            onPointerDown={(event) => {
              if (event.pointerType === "touch")
                pointer.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerUp={(event) => {
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
            {page && (
              <div
                className="reader-page-wrap"
                data-testid="reader-page"
                data-block={page.start.blockId}
                data-offset={page.start.offset}
                data-start={page.globalStart}
                data-end={pages[pages.length - 1].globalEnd}
                data-layout={spread ? "spread" : "single"}
              >
                <ReaderPages
                  pages={pages}
                  settings={settings}
                  spread={spread}
                />
              </div>
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
              {isEnd ? (
                <>
                  <Check size={14} />
                  読み終わり{" "}
                  <button
                    className="text-link"
                    onClick={() => setPanel("info")}
                  >
                    底本・制作情報
                  </button>
                </>
              ) : (
                "言葉のつづきへ。"
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
            <button aria-label="目次を開く" onClick={() => setPanel("toc")}>
              <List size={19} />
              <span>目次</span>
            </button>
            <button
              aria-label="しおり一覧を開く"
              onClick={() => setPanel("bookmarks")}
            >
              <BookmarkIcon size={19} />
              <span>しおり</span>
            </button>
            <button
              aria-label={settingsOpen ? "読書設定を閉じる" : "読書設定を開く"}
              aria-expanded={settingsOpen}
              aria-controls="reader-settings-panel"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <Settings2 size={19} />
              <span>設定</span>
            </button>
          </div>
          <div className="page-controls">
            {vertical ? next : previous}
            <span className="page-controls-divider" />
            {vertical ? previous : next}
          </div>
          <button
            className={`bookmark-add ${hasBookmark ? "marked" : ""}`}
            aria-label="このページにしおりを挟む"
            onClick={addBookmark}
            disabled={!page || loading}
          >
            <BookmarkIcon
              size={19}
              fill={hasBookmark ? "currentColor" : "none"}
            />
            <span>{hasBookmark ? "しおり済み" : "しおりを挟む"}</span>
          </button>
        </div>
      </footer>
      {panel === "info" && (
        <WorkInfo
          book={book}
          index={index}
          record={record}
          onClose={() => setPanel(null)}
          onRead={(reset) => {
            if (reset) setAnchor(createAnchor(book, book.blocks[0].id, 0));
            setPanel(null);
          }}
        />
      )}
      {panel === "toc" && (
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
          {!book.toc.length && (
            <p className="fine-print">この作品に章の見出しはありません。</p>
          )}
          <button className="text-link" onClick={() => setPanel("info")}>
            底本・制作情報を読む <Info size={14} />
          </button>
        </Modal>
      )}
      {panel === "bookmarks" && (
        <Modal title="挟んだしおり" onClose={() => setPanel(null)}>
          <div className="bookmark-list">
            {bookmarks.length ? (
              bookmarks.map((b) => (
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
              ))
            ) : (
              <div className="empty-state">
                <BookmarkIcon />
                <h3>気になる言葉に、しおりを。</h3>
                <p>「しおりを挟む」で、あとからこのページに戻れます。</p>
              </div>
            )}
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
