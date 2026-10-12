import type { ReaderPageData } from "./engine";

/** Prefix sizes remain cheap to query even when a novel contains thousands of chunks. */
export class ScrollExtentIndex {
  private readonly sizes: Float64Array;
  private readonly tree: Float64Array;

  constructor(sizes: readonly number[]) {
    this.sizes = Float64Array.from(sizes, (size) => Math.max(1, size));
    this.tree = new Float64Array(sizes.length + 1);
    for (let index = 0; index < this.sizes.length; index++) {
      const node = index + 1;
      this.tree[node] += this.sizes[index];
      const parent = node + (node & -node);
      if (parent < this.tree.length) this.tree[parent] += this.tree[node];
    }
  }

  get length() {
    return this.sizes.length;
  }
  get total() {
    return this.prefix(this.sizes.length);
  }
  extent(index: number) {
    return this.sizes[index] ?? 0;
  }

  prefix(end: number) {
    let sum = 0;
    for (
      let node = Math.max(0, Math.min(this.sizes.length, end));
      node > 0;
      node -= node & -node
    )
      sum += this.tree[node];
    return sum;
  }

  update(index: number, extent: number) {
    const size = Math.max(1, extent);
    const delta = size - this.sizes[index];
    this.sizes[index] = size;
    for (let node = index + 1; node < this.tree.length; node += node & -node)
      this.tree[node] += delta;
    return delta;
  }

  /** The chunk containing a physical scroll coordinate. */
  find(offset: number) {
    if (!this.sizes.length) return 0;
    let index = 0,
      sum = 0,
      bit = 1;
    while (bit * 2 <= this.sizes.length) bit *= 2;
    for (; bit; bit >>= 1) {
      const candidate = index + bit;
      if (
        candidate <= this.sizes.length &&
        sum + this.tree[candidate] <= Math.max(0, offset)
      ) {
        index = candidate;
        sum += this.tree[candidate];
      }
    }
    return Math.min(index, this.sizes.length - 1);
  }
}

function axisFrame(page: ReaderPageData, index: number) {
  const frame = page.context.runs[index].frame;
  return page.context.direction === "tbRl"
    ? {
        offset: page.width - page.insetX - frame.x - frame.width,
        extent: frame.width,
      }
    : { offset: page.insetY + frame.y, extent: frame.height };
}

/** Locate an original UTF-16 position without measuring any SVG DOM nodes. */
export function sourceFrame(page: ReaderPageData, position: number) {
  let source = page.globalStart;
  for (let index = 0; index < page.context.runs.length; index++) {
    const run = page.context.runs[index];
    const next = source + run.char.length;
    if (next > position || index === page.context.runs.length - 1)
      return axisFrame(page, index);
    source = next;
  }
  return null;
}

/** Return the source of visible lines; glyph offsets are already known to Stone. */
export function visibleSourceRange(
  page: ReaderPageData,
  from: number,
  to: number,
) {
  let source = page.globalStart;
  let start: number | undefined,
    end = source;
  for (let index = 0; index < page.context.runs.length; index++) {
    const run = page.context.runs[index];
    const frame = axisFrame(page, index);
    if (
      !run.isNewline &&
      frame.offset + frame.extent > from + 0.5 &&
      frame.offset < to - 0.5
    ) {
      start ??= source;
      end = source + run.char.length;
    }
    source += run.char.length;
  }
  // Image-only chunks deliberately contain no body glyphs.
  if (
    start === undefined &&
    page.images.length &&
    from < (page.context.direction === "tbRl" ? page.width : page.height) &&
    to > 0
  )
    return { start: page.globalStart, end: page.globalEnd };
  if (start === undefined) {
    // Empty paragraphs still have a source position and must not leave the
    // loading status active while the reader scrolls through their blank rows.
    let offset = page.globalStart;
    for (let index = 0; index < page.context.runs.length; index++) {
      const run = page.context.runs[index];
      const frame = axisFrame(page, index);
      if (frame.offset + frame.extent > from && frame.offset < to)
        return { start: offset, end: offset + run.char.length };
      offset += run.char.length;
    }
    if (
      !page.context.runs.length &&
      from < (page.context.direction === "tbRl" ? page.width : page.height) &&
      to > 0
    )
      return { start: page.globalStart, end: page.globalEnd };
  }
  return start === undefined ? null : { start, end };
}
