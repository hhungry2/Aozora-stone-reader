import { useLayoutEffect, useRef, type RefObject } from "react";
import { splitGraphemes } from "@non-standardworld/stone-engine.js";
import type { ReaderPageData } from "./engine";

const SVG_NS = "http://www.w3.org/2000/svg";
const DURATION = 760;
const PAGE_DURATION = 820;

/** Only deliberate previous/next actions request a dissolve; reflows stay immediate. */
export interface ReaderPageTurn {
  id: number;
  direction: 1 | -1;
}

interface ReaderTransitionOptions {
  direction: ReaderPageData["context"]["direction"];
  pageTurnAnimation: boolean;
}

interface Placement {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  opacity: number;
}

interface Glyph extends Placement {
  key: string;
  shape: SVGElement;
  column: number;
}

interface Scene {
  direction: ReaderPageData["context"]["direction"];
  start: number;
  width: number;
  height: number;
  columns: number;
  glyphs: Map<string, Glyph>;
  decorations: SVGGElement[];
}

interface Transition {
  kind: "direction" | "page";
  sample: () => Scene;
  cancel: () => void;
}

function group(document: Document) {
  return document.createElementNS(SVG_NS, "g");
}

function decorationOnly(element: SVGElement): SVGElement | null {
  if (element.localName === "text") return null;
  if (element.localName !== "g") return element.cloneNode(true) as SVGElement;
  const clone = element.cloneNode(false) as SVGGElement;
  clone.removeAttribute("data-reader-content");
  for (const child of element.children) {
    const decoration = decorationOnly(child as SVGElement);
    if (decoration) clone.append(decoration);
  }
  return clone.childElementCount ? clone : null;
}

/** Keep ruby and tate-chu-yoko together with their actual body column. */
function columnSources(page: ReaderPageData, first: number) {
  const sources = new Map<string, number>();
  const openingGlyphs = page.opening?.glyphs ?? [];
  const openingLines = [
    ...new Set(openingGlyphs.map((glyph) => glyph.run.line)),
  ].sort((a, b) => a - b);
  const openingColumns = new Map(
    openingLines.map((line, index) => [line, first + index]),
  );
  for (const glyph of openingGlyphs) {
    sources.set(`opening:${glyph.runId}`, openingColumns.get(glyph.run.line)!);
  }
  const bodyFirst = first + openingLines.length;
  const lines = [...new Set(page.context.runs.map((run) => run.line))].sort(
    (a, b) => a - b,
  );
  const lineColumns = new Map(
    lines.map((line, index) => [line, bodyFirst + index]),
  );
  let source = page.globalStart;
  for (const run of page.context.runs) {
    sources.set(`body:${source}`, lineColumns.get(run.line)!);
    source += run.char.length;
  }
  for (const ruby of page.rubies) {
    const line = Number(ruby.key.slice(ruby.key.lastIndexOf("-") + 1));
    let offset = ruby.readingOffset;
    for (const char of splitGraphemes(ruby.reading)) {
      sources.set(
        `ruby:${ruby.sourceStart}:${offset}`,
        lineColumns.get(line) ?? bodyFirst,
      );
      offset += char.length;
    }
  }
  return { sources, next: bodyFirst + lines.length };
}

/** Capture the committed SVG, including spread offsets and ruby/opening scales. */
function capture(root: HTMLDivElement, pages: ReaderPageData[]): Scene | null {
  if (!pages[0]) return null;
  const bounds = root.getBoundingClientRect();
  const glyphs = new Map<string, Glyph>();
  const decorations: SVGGElement[] = [];
  let columns = 0;
  const svgs = root.querySelectorAll<SVGSVGElement>(".reader-leaf > svg");
  for (const [index, svg] of [...svgs].entries()) {
    const page = pages[index];
    if (!page) continue;
    const mapped = columnSources(page, columns);
    columns = mapped.next;
    for (const span of svg.querySelectorAll<SVGTSpanElement>(
      "[data-reader-content] tspan[data-source]",
    )) {
      const matrix = span.getScreenCTM();
      if (!matrix) continue;
      const origin = new DOMPoint(
        span.x.baseVal.getItem(0).value,
        span.y.baseVal.getItem(0).value,
      ).matrixTransform(matrix);
      const shape = span.cloneNode(true) as SVGTSpanElement;
      shape.removeAttribute("data-run");
      shape.removeAttribute("data-source");
      shape.setAttribute("x", "0");
      shape.setAttribute("y", "0");
      shape.removeAttribute("rotate");
      const key = span.dataset.source!;
      glyphs.set(key, {
        key,
        shape,
        column: mapped.sources.get(key) ?? 0,
        x: origin.x - bounds.x,
        y: origin.y - bounds.y,
        scaleX: Math.hypot(matrix.a, matrix.b),
        scaleY: Math.hypot(matrix.c, matrix.d),
        rotate: span.rotate.baseVal.numberOfItems
          ? span.rotate.baseVal.getItem(0).value
          : 0,
        opacity: 1,
      });
    }
    const matrix = svg.getScreenCTM();
    if (!matrix) continue;
    const decoration = group(root.ownerDocument);
    decoration.setAttribute(
      "transform",
      `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e - bounds.x} ${matrix.f - bounds.y})`,
    );
    for (const content of svg.querySelectorAll<SVGGElement>(
      ":scope > [data-reader-content]",
    )) {
      const clone = decorationOnly(content);
      if (clone) decoration.append(clone);
    }
    decorations.push(decoration);
  }
  return {
    direction: pages[0].context.direction,
    start: pages[0].globalStart,
    width: bounds.width,
    height: bounds.height,
    columns,
    glyphs,
    decorations,
  };
}

function mix(from: Placement, to: Placement, progress: number): Placement {
  const lerp = (start: number, end: number) => start + (end - start) * progress;
  return {
    x: lerp(from.x, to.x),
    y: lerp(from.y, to.y),
    scaleX: lerp(from.scaleX, to.scaleX),
    scaleY: lerp(from.scaleY, to.scaleY),
    rotate: lerp(from.rotate, to.rotate),
    opacity: lerp(from.opacity, to.opacity),
  };
}

function text(document: Document, glyph: Glyph) {
  const node = document.createElementNS(SVG_NS, "text");
  node.setAttribute("xml:space", "preserve");
  node.setAttribute("fill", "currentColor");
  node.append(glyph.shape.cloneNode(true));
  return node;
}

function animate(
  root: HTMLDivElement,
  from: Scene,
  to: Scene,
  onFinish: () => void,
): Transition | null {
  const svg = root.querySelector<SVGSVGElement>(".reader-leaf > svg");
  const matrix = svg?.getScreenCTM();
  const view = root.ownerDocument.defaultView;
  if (!svg || !matrix || !view || (!to.glyphs.size && !from.glyphs.size))
    return null;
  const bounds = root.getBoundingClientRect();
  // The overlay uses reader-pages coordinates even when the first leaf swaps sides.
  const local = matrix.inverse().translate(bounds.x, bounds.y);
  const overlay = group(root.ownerDocument);
  overlay.classList.add("reader-direction-overlay");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("pointer-events", "none");
  overlay.setAttribute(
    "transform",
    `matrix(${local.a} ${local.b} ${local.c} ${local.d} ${local.e} ${local.f})`,
  );
  const oldDecorations = group(root.ownerDocument);
  const newDecorations = group(root.ownerDocument);
  oldDecorations.append(
    ...from.decorations.map((item) => item.cloneNode(true)),
  );
  newDecorations.append(...to.decorations.map((item) => item.cloneNode(true)));
  overlay.append(oldDecorations, newDecorations);

  const items = [...new Set([...from.glyphs.keys(), ...to.glyphs.keys()])].map(
    (key) => {
      const before = from.glyphs.get(key);
      const after = to.glyphs.get(key);
      const start = before ?? { ...after!, opacity: 0 };
      const end = after ?? { ...before!, opacity: 0 };
      const node = group(root.ownerDocument);
      node.dataset.source = key;
      const oldText = before ? text(root.ownerDocument, before) : null;
      const newText = after ? text(root.ownerDocument, after) : null;
      // Most characters retain their shape. Only crossfade when font features or
      // glyph content change, so punctuation can also turn into its horizontal form.
      const changesShape =
        before && after && !before.shape.isEqualNode(after.shape);
      if (changesShape) node.append(oldText!, newText!);
      else node.append(newText ?? oldText!);
      overlay.append(node);
      return {
        key,
        start,
        end,
        before,
        after,
        node,
        oldText,
        newText,
        changesShape,
      };
    },
  );

  let progress = 0;
  let frame = 0;
  let stopped = false;
  const draw = () => {
    for (const item of items) {
      const placement = mix(item.start, item.end, progress);
      item.node.setAttribute(
        "transform",
        `translate(${placement.x} ${placement.y}) scale(${placement.scaleX} ${placement.scaleY}) rotate(${placement.rotate})`,
      );
      item.node.setAttribute("opacity", String(placement.opacity));
      if (item.changesShape) {
        item.oldText!.setAttribute("opacity", String(1 - progress));
        item.newText!.setAttribute("opacity", String(progress));
      }
    }
    oldDecorations.setAttribute("opacity", String(1 - progress));
    newDecorations.setAttribute("opacity", String(progress));
  };
  const cancel = () => {
    if (stopped) return;
    stopped = true;
    view.cancelAnimationFrame(frame);
    overlay.remove();
    delete root.dataset.directionTransition;
  };
  const sample = (): Scene => ({
    ...to,
    // Retain the current blend on interruption, including punctuation shapes,
    // ruby scales, images and frames. A reversal starts at the visible positions.
    decorations: [
      oldDecorations.cloneNode(true),
      newDecorations.cloneNode(true),
    ] as SVGGElement[],
    glyphs: new Map(
      items.map((item) => {
        const shape = root.ownerDocument.createElementNS(SVG_NS, "tspan");
        for (const child of item.node.children) {
          const layer = root.ownerDocument.createElementNS(SVG_NS, "tspan");
          layer.setAttribute("opacity", child.getAttribute("opacity") ?? "1");
          layer.append(
            ...[...child.children].map((span) => span.cloneNode(true)),
          );
          shape.append(layer);
        }
        return [
          item.key,
          {
            key: item.key,
            column: (item.after ?? item.before)!.column,
            shape,
            ...mix(item.start, item.end, progress),
          },
        ];
      }),
    ),
  });
  draw();
  svg.append(overlay);
  root.dataset.directionTransition = "running";
  const started = view.performance.now();
  const tick = (now: number) => {
    if (stopped) return;
    const elapsed = Math.min(1, (now - started) / DURATION);
    // Ease in and out while retaining one shared clock for every letter and ruby.
    progress = elapsed * elapsed * (3 - 2 * elapsed);
    draw();
    if (elapsed < 1) frame = view.requestAnimationFrame(tick);
    else {
      cancel();
      onFinish();
    }
  };
  frame = view.requestAnimationFrame(tick);
  return { kind: "direction", sample, cancel };
}

function dissolve(
  root: HTMLDivElement,
  from: Scene,
  to: Scene,
  direction: 1 | -1,
  onFinish: () => void,
): Transition | null {
  const svg = root.querySelector<SVGSVGElement>(".reader-leaf > svg");
  const matrix = svg?.getScreenCTM();
  const view = root.ownerDocument.defaultView;
  if (!svg || !matrix || !view || (!to.glyphs.size && !from.glyphs.size))
    return null;
  const bounds = root.getBoundingClientRect();
  const local = matrix.inverse().translate(bounds.x, bounds.y);
  const overlay = group(root.ownerDocument);
  overlay.classList.add("reader-page-turn-overlay");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("pointer-events", "none");
  overlay.setAttribute(
    "transform",
    `matrix(${local.a} ${local.b} ${local.c} ${local.d} ${local.e} ${local.f})`,
  );
  const oldDecorations = group(root.ownerDocument);
  const newDecorations = group(root.ownerDocument);
  oldDecorations.append(
    ...from.decorations.map((item) => item.cloneNode(true)),
  );
  newDecorations.append(...to.decorations.map((item) => item.cloneNode(true)));
  overlay.append(oldDecorations, newDecorations);
  const vertical = to.direction === "tbRl";
  const items = (["outgoing", "incoming"] as const).flatMap((phase) => {
    const scene = phase === "outgoing" ? from : to;
    return [...scene.glyphs.values()].map((glyph) => {
      const node = group(root.ownerDocument);
      node.dataset.source = glyph.key;
      node.dataset.column = String(glyph.column);
      node.dataset.pageTurnPhase = phase;
      node.append(text(root.ownerDocument, glyph));
      overlay.append(node);
      // The line index comes from Stone, so ruby and tate-chu-yoko dissolve with
      // their parent even when their glyph positions use a different baseline.
      const order = scene.columns > 1 ? glyph.column / (scene.columns - 1) : 0;
      const stagger = direction === 1 ? order : 1 - order;
      const displaced: Placement = {
        ...glyph,
        x: glyph.x + (vertical ? 24 : 7) * direction,
        y: glyph.y + (vertical ? 12 : 24) * direction,
        rotate: glyph.rotate - 2 * direction,
        opacity: 0,
      };
      const start = phase === "outgoing" ? glyph : displaced;
      const end =
        phase === "outgoing"
          ? {
              ...displaced,
              x: glyph.x - (vertical ? 24 : 7) * direction,
              y: glyph.y - (vertical ? 12 : 24) * direction,
              rotate: glyph.rotate + 2 * direction,
            }
          : glyph;
      return { glyph, node, phase, stagger, start, end, placement: start };
    });
  });
  let progress = 0;
  let frame = 0;
  let stopped = false;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const draw = () => {
    for (const item of items) {
      const local =
        item.phase === "outgoing"
          ? clamp((progress - item.stagger * 0.18) / 0.42)
          : clamp((progress - 0.2 - item.stagger * 0.12) / 0.54);
      const eased =
        item.phase === "outgoing"
          ? local * local * (3 - 2 * local)
          : 1 - (1 - local) ** 3;
      item.placement = mix(item.start, item.end, eased);
      const placement = item.placement;
      item.node.setAttribute(
        "transform",
        `translate(${placement.x} ${placement.y}) scale(${placement.scaleX} ${placement.scaleY}) rotate(${placement.rotate})`,
      );
      item.node.setAttribute("opacity", String(placement.opacity));
    }
    oldDecorations.setAttribute("opacity", String(1 - clamp(progress / 0.6)));
    newDecorations.setAttribute(
      "opacity",
      String(clamp((progress - 0.2) / 0.65)),
    );
  };
  const cancel = () => {
    if (stopped) return;
    stopped = true;
    view.cancelAnimationFrame(frame);
    overlay.remove();
    delete root.dataset.pageTransition;
  };
  const sample = (): Scene => {
    const glyphs = new Map<string, Glyph>();
    for (const item of items) {
      // Retain zero-opacity incoming glyphs: a direction switch before the
      // entrance starts must still know where that same source is arriving.
      if (item.phase === "outgoing" && item.placement.opacity < 0.001) continue;
      const key = item.glyph.key;
      const existing = glyphs.get(key);
      // A quick reversal can show the same source in both layers. Keep the
      // faint outgoing copy as a ghost instead of making it jump or disappear.
      if (existing) {
        const ghost = `${key}:dissolving`;
        glyphs.set(ghost, { ...existing, key: ghost });
      }
      glyphs.set(key, { ...item.glyph, ...item.placement });
    }
    return {
      ...to,
      columns: Math.max(from.columns, to.columns),
      glyphs,
      decorations: [
        oldDecorations.cloneNode(true),
        newDecorations.cloneNode(true),
      ] as SVGGElement[],
    };
  };
  draw();
  svg.append(overlay);
  root.dataset.pageTransition = "running";
  const started = view.performance.now();
  const tick = (now: number) => {
    if (stopped) return;
    progress = Math.min(1, (now - started) / PAGE_DURATION);
    draw();
    if (progress < 1) frame = view.requestAnimationFrame(tick);
    else {
      cancel();
      onFinish();
    }
  };
  frame = view.requestAnimationFrame(tick);
  return { kind: "page", sample, cancel };
}

/** Animate committed direction changes and explicitly requested page turns. */
export function useDirectionTransition(
  root: RefObject<HTMLDivElement | null>,
  pages: ReaderPageData[],
  showFrames: boolean,
  pageTurn?: ReaderPageTurn | null,
  options?: ReaderTransitionOptions,
) {
  const targetDirection = options?.direction ?? pages[0]?.context.direction;
  const pageTurnAnimation = options?.pageTurnAnimation ?? false;
  const previous = useRef<Scene | null>(null);
  const active = useRef<Transition | null>(null);
  const committedPages = useRef(pages);
  const committedFrames = useRef(showFrames);
  const lastTurn = useRef(pageTurn?.id);
  const pendingTurn = useRef<ReaderPageTurn | null>(null);
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const pagesChanged = committedPages.current !== pages;
    committedPages.current = pages;
    const requested = lastTurn.current !== pageTurn?.id;
    const framesChanged = committedFrames.current !== showFrames;
    committedFrames.current = showFrames;
    lastTurn.current = pageTurn?.id;
    const cancel = () => {
      active.current?.cancel();
      active.current = null;
    };
    if (requested)
      pendingTurn.current = pageTurnAnimation ? (pageTurn ?? null) : null;
    if (!pageTurnAnimation) {
      pendingTurn.current = null;
      // Turning the setting off removes an in-flight dissolve immediately.
      // Direction changes remain independent of this optional page effect.
      if (active.current?.kind === "page") {
        cancel();
        previous.current = null;
      }
    }
    if (
      container.ownerDocument.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      cancel();
      previous.current = null;
      pendingTurn.current = null;
      return;
    }
    const page = pages[0];
    // usePagination commits on a deferred task. Capture its old SVG only when
    // an action actually requests movement, before the new layout replaces it.
    // Ordinary paging with the effect off never reads or clones glyph geometry.
    if (page && targetDirection !== page.context.direction) {
      previous.current = active.current?.sample() ?? capture(container, pages);
      return;
    }
    if (requested && pendingTurn.current && !pagesChanged && !framesChanged) {
      previous.current = active.current?.sample() ?? capture(container, pages);
      return;
    }
    if (!pagesChanged) {
      if (framesChanged) {
        cancel();
        previous.current = null;
        pendingTurn.current = null;
      }
      return;
    }
    const saved = previous.current;
    const turn = pendingTurn.current;
    previous.current = null;
    pendingTurn.current = null;
    const directionChanged =
      saved &&
      page &&
      saved.direction !== page.context.direction &&
      saved.start === page.globalStart;
    const pageChanged =
      pageTurnAnimation &&
      turn &&
      saved &&
      page &&
      saved.direction === page.context.direction &&
      saved.start !== page.globalStart;
    if (!directionChanged && !pageChanged) {
      cancel();
      return;
    }
    const before = active.current?.sample() ?? saved;
    const next = capture(container, pages);
    cancel();
    if (
      !before ||
      !next ||
      Math.abs(before.width - next.width) > 1 ||
      Math.abs(before.height - next.height) > 1
    )
      return;
    const finished = () => {
      active.current = null;
    };
    if (directionChanged) {
      active.current = animate(container, before, next, finished);
    } else if (turn) {
      active.current = dissolve(
        container,
        before,
        next,
        turn.direction,
        finished,
      );
    }
  }, [
    pages,
    root,
    showFrames,
    pageTurn?.id,
    pageTurn?.direction,
    targetDirection,
    pageTurnAnimation,
  ]);

  useLayoutEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => {
      active.current?.cancel();
      active.current = null;
    };
    const resize = () => {
      cancel();
      previous.current = null;
      pendingTurn.current = null;
    };
    const motionChange = () => {
      cancel();
      // Consume an action waiting for pagination as well, so toggling motion
      // back on does not replay a turn requested before the preference changed.
      pendingTurn.current = null;
      previous.current = null;
    };
    const visibility = () => {
      if (document.hidden) {
        cancel();
        pendingTurn.current = null;
        previous.current = null;
      }
    };
    preference.addEventListener("change", motionChange);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancel();
      preference.removeEventListener("change", motionChange);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [root]);
}
