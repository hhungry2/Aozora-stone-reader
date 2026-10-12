import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ExternalLink,
  Info,
  LoaderCircle,
} from "lucide-react";
import type { Book } from "../types";
import {
  normalizeWebNovelUrl,
  type WebNovelInfo,
  type WebNovelPage,
} from "../lib/web-novel";
import {
  fetchWebNovel,
  getRecentWebNovels,
  getWebNovelProxy,
  saveWebNovelProxy,
} from "../lib/web-novel-client";
import "./web-novel.css";

export const webNovelHref = (url: string) => `#/web/${encodeURIComponent(url)}`;

function ProxySettings({
  required = false,
  onSave,
}: {
  required?: boolean;
  onSave?: () => void;
}) {
  const [value, setValue] = useState(getWebNovelProxy);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const save = (event: FormEvent) => {
    event.preventDefault();
    try {
      saveWebNovelProxy(value.trim());
      setError("");
      setMessage("接続設定を保存しました");
      onSave?.();
    } catch (error) {
      setMessage("");
      setError(
        error instanceof Error ? error.message : "設定を保存できませんでした。",
      );
    }
  };
  return (
    <details className="web-novel-connection" open={required || undefined}>
      <summary>Web小説の接続設定</summary>
      <p>
        Google Apps Scriptで用意した取得先のURLを、このブラウザに保存します。
      </p>
      <form onSubmit={save}>
        <label htmlFor="web-novel-proxy">Google Apps Scriptの公開URL</label>
        <div className="web-novel-input-row">
          <input
            id="web-novel-proxy"
            type="url"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://script.google.com/macros/s/…/exec"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="button" type="submit">
            保存
          </button>
        </div>
      </form>
      <div className="web-novel-navigation">
        <a
          className="text-link"
          href={`${import.meta.env.BASE_URL}web-novel-proxy.gs.txt`}
          target="_blank"
          rel="noreferrer"
        >
          GAS用コードを開く <ExternalLink size={14} />
        </a>
        <a
          className="text-link"
          href="https://script.google.com/home"
          target="_blank"
          rel="noreferrer"
        >
          Google Apps Scriptを開く <ExternalLink size={14} />
        </a>
      </div>
      <ol className="web-novel-setup-steps">
        <li>新しいプロジェクトにGAS用コードを貼り付け、保存します。</li>
        <li>「デプロイ」→「新しいデプロイ」→「ウェブアプリ」を選びます。</li>
        <li>
          実行するユーザーを「自分」、アクセスできるユーザーを「全員」にして公開します。
        </li>
        <li>発行された末尾が「/exec」のURLを上の欄に保存します。</li>
      </ol>
      {error && (
        <p className="web-novel-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}

export function WebNovelLauncher() {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [recent] = useState(getRecentWebNovels);
  const open = (event: FormEvent) => {
    event.preventDefault();
    try {
      const url = normalizeWebNovelUrl(value.trim());
      setError("");
      location.hash = webNovelHref(url).slice(1);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "作品のURLを確認してください。",
      );
    }
  };
  return (
    <section
      className="web-novel-launcher"
      id="web-novel-entry"
      aria-labelledby="web-novel-heading"
    >
      <div className="web-novel-heading">
        <BookOpen size={24} aria-hidden="true" />
        <div>
          <h2 id="web-novel-heading" className="serif">
            Web小説を読む
          </h2>
          <p>小説家になろう・カクヨムの作品や各話のURLを入力してください。</p>
        </div>
      </div>
      <form onSubmit={open}>
        <label htmlFor="web-novel-url">作品・各話のURL</label>
        <div className="web-novel-input-row">
          <input
            id="web-novel-url"
            type="url"
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://ncode.syosetu.com/…/ または https://kakuyomu.jp/works/…"
            aria-describedby="web-novel-help"
            autoComplete="url"
            spellCheck={false}
          />
          <button className="button primary" type="submit">
            開く <ArrowRight size={17} />
          </button>
        </div>
      </form>
      <p id="web-novel-help" className="fine-print">
        開いたページの本文を公開元から取得し、縦書き・横書きで表示します。
      </p>
      {error && (
        <p className="web-novel-error" role="alert">
          {error}
        </p>
      )}
      <ProxySettings />
      {recent.length > 0 && (
        <div className="web-novel-recent">
          <h3>最近開いたWeb小説</h3>
          <ul>
            {recent.slice(0, 6).map((item) => (
              <li key={item.url}>
                <a href={webNovelHref(item.url)}>{item.title}</a>
                <span>
                  {item.author} · {item.siteName}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function WebNovelNavigation({ info }: { info: WebNovelInfo }) {
  return (
    <nav className="web-novel-navigation" aria-label="話の移動">
      {info.previousUrl && (
        <a className="button" href={webNovelHref(info.previousUrl)}>
          <ArrowLeft size={16} /> 前の話
        </a>
      )}
      <a
        className="button"
        href={info.url === info.workUrl ? "#/" : webNovelHref(info.workUrl)}
      >
        {info.url === info.workUrl ? "本棚へ" : "作品の目次"}
      </a>
      {info.nextUrl && (
        <a className="button" href={webNovelHref(info.nextUrl)}>
          次の話 <ArrowRight size={16} />
        </a>
      )}
    </nav>
  );
}

export function WebNovelScreen({
  url,
  renderReader,
}: {
  url: string;
  renderReader: (book: Book, info: WebNovelInfo) => ReactNode;
}) {
  const [page, setPage] = useState<WebNovelPage | null>(null);
  const [error, setError] = useState("");
  const [requiresProxy, setRequiresProxy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setError("");
    setRequiresProxy(false);
    fetchWebNovel(url, { signal: controller.signal, force: retry > 0 })
      .then((result) => {
        if (!controller.signal.aborted) setPage(result);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setRequiresProxy(error?.code === "proxy-required");
        setError(
          error instanceof Error
            ? error.message
            : "作品を取得できませんでした。",
        );
      });
    return () => controller.abort();
  }, [url, retry]);
  if (page?.book) return renderReader(page.book, page.info);
  const info = page?.info;
  let sourceUrl = "";
  try {
    sourceUrl = normalizeWebNovelUrl(url);
  } catch {
    /* Invalid URLs have no outbound link. */
  }
  return (
    <main className="web-novel-screen" id="main-content" tabIndex={-1}>
      <a className="text-link" href="#/">
        <ArrowLeft size={17} /> 本棚へ
      </a>
      {error ? (
        <div className="web-novel-load-state">
          <Info size={28} />
          <h1>Web小説を開けませんでした</h1>
          <p role="alert">{error}</p>
          {!requiresProxy && (
            <button
              className="button primary"
              onClick={() => setRetry((value) => value + 1)}
            >
              もう一度読み込む
            </button>
          )}
          <ProxySettings
            required={requiresProxy}
            onSave={() => setRetry((value) => value + 1)}
          />
          {sourceUrl && (
            <a
              className="text-link"
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              公開元で開く <ExternalLink size={14} />
            </a>
          )}
        </div>
      ) : info ? (
        <>
          <header className="web-novel-work-heading">
            <span className="eyebrow">{info.siteName}</span>
            <h1 className="serif">{info.title}</h1>
            <p>{info.author}</p>
            <div className="web-novel-navigation">
              <a
                className="text-link"
                href={info.url}
                target="_blank"
                rel="noreferrer"
              >
                公開元で開く <ExternalLink size={14} />
              </a>
              <button
                className="text-link"
                onClick={() => setRetry((value) => value + 1)}
              >
                情報を更新
              </button>
            </div>
            {info.description && (
              <p className="web-novel-description">{info.description}</p>
            )}
          </header>
          <section aria-labelledby="web-novel-toc-heading">
            <h2 id="web-novel-toc-heading">目次</h2>
            {info.episodes.length ? (
              <ol className="web-novel-episodes">
                {info.episodes.map((episode, index) => (
                  <li key={episode.url}>
                    {episode.chapter &&
                      episode.chapter !== info.episodes[index - 1]?.chapter && (
                        <h3>{episode.chapter}</h3>
                      )}
                    <a href={webNovelHref(episode.url)}>
                      <span>{episode.title}</span>
                      <ArrowRight size={17} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ol>
            ) : (
              <p>
                このページには読み込める各話のリンクがありません。公開元をご確認ください。
              </p>
            )}
            {(info.indexPagePreviousUrl || info.indexPageNextUrl) && (
              <nav className="web-novel-navigation" aria-label="目次のページ">
                {info.indexPagePreviousUrl && (
                  <a
                    className="button"
                    href={webNovelHref(info.indexPagePreviousUrl)}
                  >
                    <ArrowLeft size={17} /> 前の目次
                  </a>
                )}
                {info.indexPageNextUrl && (
                  <a
                    className="button"
                    href={webNovelHref(info.indexPageNextUrl)}
                  >
                    次の目次 <ArrowRight size={17} />
                  </a>
                )}
              </nav>
            )}
          </section>
        </>
      ) : (
        <div className="web-novel-load-state" role="status">
          <LoaderCircle className="spin" size={28} />
          <p>Web小説を開いています</p>
        </div>
      )}
    </main>
  );
}
