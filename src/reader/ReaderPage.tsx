import { handleStoneCopy, runRangeOfSelection, textOfRunRange, type GlyphElement } from '@non-standardworld/stone-engine.js';
import { memo, useLayoutEffect, useRef, type ReactNode } from 'react';
import { fontFamilies, type ReaderSettings } from '../types';
import type { ReaderPageData } from './engine';

function Glyphs({ glyphs, prefix = '' }: { glyphs: GlyphElement[]; prefix?: string }) {
  return <text xmlSpace="preserve" fill="currentColor">{glyphs.map((glyph) => <tspan
    key={`${prefix}${glyph.runId}`} data-run={prefix ? undefined : glyph.runId}
    x={glyph.x} y={glyph.y} rotate={glyph.rotate || undefined}
    fontFamily={glyph.fontFamily} fontSize={glyph.fontSize} fontWeight={glyph.fontWeight} fontStyle={glyph.fontStyle}
    style={{ fontFeatureSettings: glyph.vertical ? (glyph.fullWidth ? '"fwid" 1, "vert" 1, "vrt2" 1' : '"vert" 1, "vrt2" 1') : glyph.fullWidth ? '"fwid" 1' : undefined }}
  >{glyph.text}</tspan>)}</text>;
}

function AccessibleText({ page, settings }: { page: ReaderPageData; settings: ReaderSettings }) {
  const content: ReactNode[] = [];
  for (const range of page.ranges) {
    const from = Math.max(0, page.globalStart - range.start);
    const to = Math.min(range.end - range.start, page.globalEnd - range.start);
    if (to <= from) continue;
    const text = range.block.kind === 'image' && !range.block.text ? '\ufffc' : range.block.text;
    const pieces: ReactNode[] = [];
    const plain = (start: number, end: number): ReactNode[] => {
      const parts: ReactNode[] = [];
      let at = start;
      for (const image of [...range.block.inlineImages].sort((a, b) => a.start - b.start)) {
        if (image.start < at || image.end > end) continue;
        parts.push(text.slice(at, image.start));
        parts.push(<span key={`image-${image.start}`} role="img" aria-label={image.alt}>{image.alt}</span>);
        at = image.end;
      }
      parts.push(text.slice(at, end));
      return parts;
    };
    let position = from;
    const decorations = (settings.ruby ? range.block.rubies : [])
      .filter((ruby) => ruby.start >= from && ruby.end <= to).sort((a, b) => a.start - b.start);
    for (const item of decorations) {
      if (item.start < position) continue;
      pieces.push(...plain(position, item.start));
      pieces.push(<ruby key={item.start}>{plain(item.start, item.end)}<rt>{item.reading}</rt></ruby>);
      position = item.end;
    }
    pieces.push(...plain(position, to));
    content.push(range.block.kind === 'heading'
      ? <div key={range.block.id} role="heading" aria-level={Math.min(6, range.block.level ?? 2)}>{pieces}</div>
      : range.block.kind === 'image' && range.block.image
        ? <div key={range.block.id} role="img" aria-label={range.block.image.alt}>{range.block.image.alt}</div>
        : <p key={range.block.id}>{pieces}</p>);
  }
  return <div className="sr-only reader-accessible-text" style={{ fontFamily: fontFamilies[settings.font], userSelect: 'none' }}>{content}</div>;
}

export function ReaderPage({ page, settings, className }: { page: ReaderPageData; settings: ReaderSettings; className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = root.current;
    return () => {
      const selection = container?.ownerDocument.getSelection();
      // Reflow replaces the selected SVG glyphs. Release that page's selection before
      // Firefox recalculates their geometry, while leaving selections elsewhere intact.
      if (container && selection?.anchorNode && selection.focusNode
        && container.contains(selection.anchorNode) && container.contains(selection.focusNode)) {
        selection.removeAllRanges();
      }
    };
  }, [page, settings.direction, settings.fontSize, settings.lineHeight, settings.font, settings.ruby]);
  return <div ref={root} className={className} data-testid="reader-leaf" data-start={page.globalStart} data-end={page.globalEnd}
    style={{ width: page.width, height: page.height, position: 'relative', maxWidth: '100%' }}
    onCopy={(event) => {
      const image = svg.current;
      const container = root.current;
      const selection = container?.ownerDocument.getSelection();
      if (!image || !container || !event.clipboardData || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return;
      // Selecting the entire page also selects its accessibility HTML. Copy the source
      // once, retaining leading/trailing whitespace and image placeholders.
      if (range.comparePoint(image, 0) === 0 && range.comparePoint(image, image.childNodes.length) === 0) {
        event.clipboardData.setData('text/plain', page.text);
        event.preventDefault();
        return;
      }
      handleStoneCopy(event, page.context, image);
    }}>
    {page.opening && <header className="sr-only reader-opening-info">
      <h1>{page.opening.title}</h1>
      {page.opening.subtitle && <p>{page.opening.subtitle}</p>}
      <p>{page.opening.author}</p>
    </header>}
    <svg ref={svg} width={page.width} height={page.height} viewBox={`0 0 ${page.width} ${page.height}`}
      aria-hidden="true" focusable="false" data-stone-direction={settings.direction} data-start={page.globalStart} data-end={page.globalEnd}
      style={{ display: 'block', overflow: 'visible', userSelect: 'text', maxWidth: '100%' }}>
      {page.opening && <g className="reader-opening" transform={`translate(${page.opening.x} ${page.opening.y}) scale(${page.opening.scale})`}>
        <Glyphs glyphs={page.opening.glyphs} prefix="opening-" />
      </g>}
      <g transform={`translate(${page.insetX} ${page.insetY})`}>
        {settings.showFrames && <g className="reader-glyph-frames" fill="none" stroke="rgba(0,128,255,0.6)" strokeWidth="0.7" pointerEvents="none" style={{ userSelect: 'none' }}>
          {page.context.runs.filter((run) => !run.isNewline).map((run, index) => <rect key={index}
            x={run.frame.x} y={run.frame.y} width={run.frame.width} height={run.frame.height} />)}
        </g>}
        <Glyphs glyphs={page.glyphs} />
        <g className="reader-rubies" style={{ userSelect: 'none' }}>{page.rubies.map((ruby) => <g key={ruby.key}
          transform={`translate(${ruby.x} ${ruby.y}) scale(${ruby.scaleX} ${ruby.scaleY})`}>
          <Glyphs glyphs={ruby.glyphs} prefix={`${ruby.key}-`} />
        </g>)}</g>
        <g style={{ userSelect: 'none' }}>{page.emphasis.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={point.radius} fill="currentColor" />)}</g>
        {page.images.map((image, index) => <image key={index} href={`${import.meta.env.BASE_URL}${image.src.replace(/^\//u, '')}`}
          x={image.x} y={image.y} width={image.width} height={image.height} preserveAspectRatio="xMidYMid meet"><title>{image.alt}</title></image>)}
      </g>
    </svg>
    <AccessibleText page={page} settings={settings} />
  </div>;
}

export const ReaderPages = memo(function ReaderPages({ pages, settings, spread }: { pages: ReaderPageData[]; settings: ReaderSettings; spread: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = root.current;
    return () => {
      const selection = container?.ownerDocument.getSelection();
      if (container && selection?.anchorNode && selection.focusNode
        && container.contains(selection.anchorNode) && container.contains(selection.focusNode)) selection.removeAllRanges();
    };
  }, [pages]);
  return <div ref={root} className={`reader-pages${spread ? ' spread' : ''}`} onCopy={(event) => {
    if (event.defaultPrevented || pages.length < 2 || !event.clipboardData) return;
    const container = event.currentTarget;
    const selection = container.ownerDocument.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return;
    const fragments = [...container.querySelectorAll('svg')].map((svg, index) => {
      const fullStart = range.comparePoint(svg, 0) === 0;
      const fullEnd = range.comparePoint(svg, svg.childNodes.length) === 0;
      if (fullStart && fullEnd) return pages[index].text;
      const runs = runRangeOfSelection(svg, range);
      return runs ? textOfRunRange(pages[index].context, fullStart ? 0 : runs[0], fullEnd ? pages[index].context.runs.length : runs[1]) : '';
    });
    if (fragments.some(Boolean)) {
      event.clipboardData.setData('text/plain', fragments.join(''));
      event.preventDefault();
    }
  }}>
    {pages.map((page, index) => <ReaderPage key={index} page={page} settings={settings} className="reader-leaf" />)}
    {spread && pages.length === 1 && <div className="reader-leaf reader-blank-page" aria-hidden="true" style={{ width: pages[0].width, height: pages[0].height }} />}
  </div>;
});
