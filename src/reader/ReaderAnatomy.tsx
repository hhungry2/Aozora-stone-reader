import { ChevronLeft, ChevronRight, ScanText, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { Rect } from "@non-standardworld/stone-engine.js";
import type { AnatomyGlyph, AnatomyLineBreak, PageAnatomy } from "./anatomy";

const number = (value: number) =>
  Number(value.toFixed(2)).toLocaleString("ja-JP");

export function AnatomyOverlay({
  anatomy,
  selected,
  vertical,
}: {
  anatomy: PageAnatomy;
  selected?: AnatomyGlyph;
  vertical: boolean;
}) {
  const box = (frame: Rect, className: string, key?: string) => (
    <rect
      key={key}
      className={className}
      x={frame.x}
      y={frame.y}
      width={Math.max(0.5, frame.width)}
      height={Math.max(0.5, frame.height)}
    />
  );
  return (
    <g
      className="reader-anatomy-overlay"
      aria-hidden="true"
      pointerEvents="none"
      style={{ userSelect: "none" }}
    >
      {anatomy.kinsokuBreaks.map((item) => (
        <g
          key={item.sourceEnd}
          className="anatomy-break"
          data-kinsoku-end={item.sourceEnd}
        >
          <circle
            cx={
              vertical
                ? item.endFrame.x - 4
                : item.endFrame.x + item.endFrame.width
            }
            cy={
              vertical
                ? item.endFrame.y + item.endFrame.height
                : item.endFrame.y - 4
            }
            r="3"
          />
        </g>
      ))}
      {selected && (
        <g data-source={`body:${selected.sourceStart}`}>
          {selected.rubies.map((ruby) => (
            <g key={ruby.key} className="anatomy-ruby">
              {box(ruby.parentFrame, "anatomy-parent")}
              {box(ruby.readingFrame, "anatomy-reading")}
              <path
                d={`M${ruby.parentFrame.x + ruby.parentFrame.width} ${ruby.parentFrame.y} L${ruby.readingFrame.x} ${ruby.readingFrame.y + ruby.readingFrame.height}`}
              />
            </g>
          ))}
          {box(selected.frame, "anatomy-frame")}
          <g className="anatomy-advance">
            {vertical ? (
              <>
                <path
                  d={`M${selected.frame.x - 3} ${selected.frame.y} v${selected.frame.height}`}
                />
                <path
                  d={`M${selected.frame.x - 6} ${selected.frame.y} h6 M${selected.frame.x - 6} ${selected.frame.y + selected.frame.height} h6`}
                />
              </>
            ) : (
              <>
                <path
                  d={`M${selected.frame.x} ${selected.frame.y + selected.frame.height + 3} h${selected.frame.width}`}
                />
                <path
                  d={`M${selected.frame.x} ${selected.frame.y + selected.frame.height} v6 M${selected.frame.x + selected.frame.width} ${selected.frame.y + selected.frame.height} v6`}
                />
              </>
            )}
          </g>
        </g>
      )}
    </g>
  );
}

function breakDescription(item: AnatomyLineBreak) {
  const text = item.forbiddenText ? `「${item.forbiddenText}」` : "文字";
  if (item.reason === "line-start")
    return `${text}が行頭に来ないよう改行位置を調整`;
  if (item.reason === "line-end")
    return `${text}が行末に残らないよう改行位置を調整`;
  if (item.reason === "inseparable")
    return `${text}を途中で分けないよう改行位置を調整`;
  return "禁則処理によって改行位置を調整";
}

export function AnatomyPanel({
  selected,
  kinsoku,
  onFirst,
  onPrevious,
  onNext,
  onClear,
  hasPrevious,
  hasNext,
  style,
}: {
  selected?: AnatomyGlyph;
  kinsoku: boolean;
  onFirst: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClear: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  style?: CSSProperties;
}) {
  return (
    <section
      className="reader-anatomy-panel"
      style={style}
      aria-label="組版の解剖"
      data-source={selected ? `body:${selected.sourceStart}` : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <div className="anatomy-panel-head">
        <span>
          <ScanText size={15} aria-hidden="true" /> 組版の解剖
        </span>
        {selected && (
          <button aria-label="文字の選択を解除" onClick={onClear}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {selected ? (
        <>
          <div className="anatomy-character-row">
            <strong
              className="anatomy-character"
              aria-label={`選択した文字 ${selected.text}`}
            >
              {/^\s+$/u.test(selected.text) ? "空白" : selected.text}
            </strong>
            <span>
              {selected.punctuation ? "約物" : "本文の文字"} ·{" "}
              {number(selected.fontSize)}px
            </span>
            <div className="anatomy-character-nav">
              <button
                aria-label="前の文字"
                onClick={onPrevious}
                disabled={!hasPrevious}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button
                aria-label="次の文字"
                onClick={onNext}
                disabled={!hasNext}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <dl className="anatomy-values">
            <dt className="anatomy-frame-label">文字枠</dt>
            <dd>
              {number(selected.frame.width)} × {number(selected.frame.height)}{" "}
              px
            </dd>
            <dt className="anatomy-advance-label">送り幅</dt>
            <dd>
              {number(selected.inlineExtent)} px{" "}
              <small>（{number(selected.emRatio)} em）</small>
            </dd>
            {selected.punctuation && (
              <>
                <dt>約物の字幅</dt>
                <dd>
                  {number(selected.measuredAdvance)} px{" "}
                  <small>（フォント計測値）</small>
                </dd>
              </>
            )}
            <dt className="anatomy-ruby-label">ルビ</dt>
            <dd>
              {selected.rubies.length
                ? selected.rubies.map((ruby) => (
                    <span className="anatomy-ruby-detail" key={ruby.key}>
                      <ruby>
                        {ruby.parentText}
                        <rt>{ruby.reading}</rt>
                      </ruby>
                      <small>
                        親文字の範囲へ割付
                        {Math.min(ruby.scaleX, ruby.scaleY) < 0.999
                          ? ` · ${number(Math.min(ruby.scaleX, ruby.scaleY) * 100)}%に縮小`
                          : ""}
                      </small>
                    </span>
                  ))
                : "この文字にはありません"}
            </dd>
            <dt className="anatomy-break-label">禁則</dt>
            <dd>
              {!kinsoku
                ? "禁則処理はオフです"
                : selected.kinsokuBreak
                  ? breakDescription(selected.kinsokuBreak)
                  : "この行に改行調整はありません"}
            </dd>
          </dl>
        </>
      ) : (
        <div className="anatomy-instructions">
          <p>文字をなぞる・タップすると、組版のしくみが見えます。</p>
          <button onClick={onFirst}>
            最初の文字を調べる <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      <p className="anatomy-legend">
        <span className="anatomy-frame-label">文字枠</span>
        <span className="anatomy-advance-label">送り幅</span>
        <span className="anatomy-ruby-label">ルビ</span>
        <span className="anatomy-break-label">禁則の改行点</span>
      </p>
    </section>
  );
}
