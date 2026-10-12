import { useEffect, useRef, useState } from "react";
import { ChevronDown, Pause, Play, Square, Volume2, X } from "lucide-react";
import type { Anchor, ReaderSettings } from "../types";
import type { ReadAloud } from "./useReadAloud";
import "./speech.css";

export function ReaderSpeechControls({
  speech,
  settings,
  onSettings,
  getAnchor,
  disabled,
}: {
  speech: ReadAloud;
  settings: ReaderSettings;
  onSettings: (settings: ReaderSettings) => void;
  getAnchor: () => Anchor;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const active = speech.status === "speaking" || speech.status === "paused";
  const label =
    speech.status === "speaking"
      ? "読み上げを一時停止"
      : speech.status === "paused"
        ? "読み上げを再開"
        : "ここから読み上げる";
  const japanese = speech.voices.filter((voice) =>
    /^ja(?:[-_]|$)/iu.test(voice.lang),
  );
  const others = speech.voices.filter(
    (voice) => !/^ja(?:[-_]|$)/iu.test(voice.lang),
  );
  const hasSelectedVoice = speech.voices.some(
    (voice) => voice.voiceURI === settings.speechVoiceURI,
  );

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const play = () => {
    if (speech.status === "speaking") speech.pause();
    else if (speech.status === "paused") speech.resume();
    else speech.start(getAnchor());
  };
  return (
    <div
      className="reader-speech"
      ref={root}
      data-status={speech.status}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          toggle.current?.focus();
          event.stopPropagation();
        }
      }}
    >
      <button
        className="speech-play"
        onClick={play}
        disabled={!speech.supported || (!active && disabled)}
        aria-label={label}
        title={
          speech.supported ? label : "このブラウザは読み上げに対応していません"
        }
      >
        {speech.status === "speaking" ? (
          <Pause size={16} aria-hidden="true" />
        ) : active ? (
          <Play size={16} aria-hidden="true" />
        ) : (
          <Volume2 size={16} aria-hidden="true" />
        )}
        <span>
          {speech.status === "speaking"
            ? "一時停止"
            : speech.status === "paused"
              ? "再開"
              : "読み上げ"}
        </span>
      </button>
      {active && (
        <button
          className="speech-stop"
          aria-label="読み上げを停止"
          title="読み上げを停止"
          onClick={speech.stop}
        >
          <Square size={15} aria-hidden="true" />
        </button>
      )}
      <button
        ref={toggle}
        className="speech-options"
        aria-label="読み上げ設定を開く"
        title="読み上げ設定"
        aria-expanded={open}
        aria-controls="reader-speech-panel"
        onClick={() => {
          if (!open) speech.loadVoices();
          setOpen((value) => !value);
        }}
      >
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <span className="sr-only" role="status">
        {speech.status === "speaking"
          ? "読み上げ中"
          : speech.status === "paused"
            ? "読み上げを一時停止しました"
            : speech.status === "finished"
              ? "読み上げが完了しました"
              : ""}
      </span>
      {speech.error && (
        <span className="speech-error" role="alert">
          {speech.error}
        </span>
      )}
      {open && (
        <div
          ref={panel}
          id="reader-speech-panel"
          className="speech-panel"
          role="region"
          aria-label="読み上げ設定"
          tabIndex={-1}
        >
          <div className="speech-panel-head">
            <strong>読み上げ</strong>
            <button
              aria-label="読み上げ設定を閉じる"
              onClick={() => {
                setOpen(false);
                toggle.current?.focus();
              }}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          {speech.supported ? (
            <>
              <p>表示中の位置から、本文を続けて読み上げます。</p>
              <label htmlFor="speech-voice">音声</label>
              <select
                id="speech-voice"
                value={hasSelectedVoice ? settings.speechVoiceURI : ""}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    speechVoiceURI: event.target.value,
                  })
                }
              >
                <option value="">自動（日本語を優先）</option>
                {japanese.length > 0 && (
                  <optgroup label="日本語">
                    {japanese.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {others.length > 0 && (
                  <optgroup label="その他の言語">
                    {others.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name}（{voice.lang}）
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div className="speech-rate-label">
                <label htmlFor="speech-rate">読み上げ速度</label>
                <output htmlFor="speech-rate">
                  {settings.speechRate.toFixed(1)}倍
                </output>
              </div>
              <input
                id="speech-rate"
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={settings.speechRate}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    speechRate: Number(event.target.value),
                  })
                }
              />
              <div className="speech-panel-actions">
                <button
                  className="button primary"
                  onClick={play}
                  disabled={!active && disabled}
                >
                  {speech.status === "speaking" ? (
                    <Pause size={16} aria-hidden="true" />
                  ) : (
                    <Play size={16} aria-hidden="true" />
                  )}
                  {label}
                </button>
                <button
                  className="button"
                  onClick={speech.stop}
                  disabled={!active}
                >
                  <Square size={15} aria-hidden="true" />
                  停止
                </button>
              </div>
              {speech.excerpt && (
                <p className="speech-excerpt">{speech.excerpt}</p>
              )}
              <p className="speech-help">
                ルビの読みを使います。音声・速度の変更は次の文から反映されます。一時停止からは文の先頭に戻って再開します。
              </p>
              {speech.voices.length === 0 && (
                <p className="speech-help">
                  音声一覧を取得できない場合は、端末の既定の音声を使います。
                </p>
              )}
            </>
          ) : (
            <p>このブラウザは読み上げに対応していません。</p>
          )}
        </div>
      )}
    </div>
  );
}
