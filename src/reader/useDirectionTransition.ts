import { useLayoutEffect, useRef, type RefObject } from "react";
import type { ReaderPageData } from "./engine";

const SVG_NS = "http://www.w3.org/2000/svg";
const DURATION = 760;

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
}

interface Scene {
  direction: ReaderPageData["context"]["direction"];
  start: number;
  width: number;
  height: number;
  glyphs: Map<string, Glyph>;
  decorations: SVGGElement[];
}

interface Transition {
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

/** Capture the committed SVG, including spread offsets and ruby/opening scales. */
function capture(root: HTMLDivElement, pages: ReaderPageData[]): Scene | null {
  if (!pages[0]) return null;
  const bounds = root.getBoundingClientRect();
  const glyphs = new Map<string, Glyph>();
  const decorations: SVGGElement[] = [];
  for (const svg of root.querySelectorAll<SVGSVGElement>(
    ".reader-leaf > svg",
  )) {
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
          { key: item.key, shape, ...mix(item.start, item.end, progress) },
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
  return { sample, cancel };
}

/** Animate only a committed direction change; ordinary reflows and paging stay immediate. */
export function useDirectionTransition(
  root: RefObject<HTMLDivElement | null>,
  pages: ReaderPageData[],
  showFrames: boolean,
) {
  const previous = useRef<Scene | null>(null);
  const active = useRef<Transition | null>(null);
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const next = capture(container, pages);
    const before = active.current?.sample() ?? previous.current;
    active.current?.cancel();
    active.current = null;
    previous.current = next;
    if (
      !before ||
      !next ||
      before.direction === next.direction ||
      before.start !== next.start ||
      Math.abs(before.width - next.width) > 1 ||
      Math.abs(before.height - next.height) > 1 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    active.current = animate(container, before, next, () => {
      active.current = null;
    });
  }, [pages, root, showFrames]);

  useLayoutEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => {
      active.current?.cancel();
      active.current = null;
    };
    const resize = () => {
      cancel();
      previous.current = null;
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    preference.addEventListener("change", cancel);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancel();
      preference.removeEventListener("change", cancel);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [root]);
}
