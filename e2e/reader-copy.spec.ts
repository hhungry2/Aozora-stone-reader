import { expect, test } from '@playwright/test';
import type { Book } from '../src/types';

test('copying a page or a selected passage preserves source text without ruby or remaining pages', async ({ page }) => {
  await page.goto('/#/read/000127');
  const rendered = page.getByTestId('reader-page');
  await expect(rendered.locator('svg')).toBeVisible();
  for (const direction of ['tbRl', 'lrTb']) {
    if (direction === 'lrTb') {
      await page.getByRole('button', { name: '横書きに切り替え' }).click();
      expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
    }
    await expect(rendered.locator('svg')).toHaveAttribute('data-stone-direction', direction);
    await expect(page.locator('.reader-loading')).toHaveCount(0);
    await expect(rendered.locator('.reader-rubies tspan').first()).toBeVisible();
    const actual = await rendered.evaluate(async (wrapper) => {
      const svg = wrapper.querySelector('svg')!;
      const container = svg.parentElement!;
      const book = await (await fetch('data/books/000127.json')).json();
      const normalized = book.blocks.map((block: { text: string }) => block.text).join('\n');
      const pageText = normalized.slice(Number(wrapper.getAttribute('data-start')), Number(wrapper.getAttribute('data-end')));
      const selection = window.getSelection()!;
      const copy = (range: Range, target: Element) => {
        selection.removeAllRanges(); selection.addRange(range);
        const clipboardData = new DataTransfer();
        const event = new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return { text: event.clipboardData?.getData('text/plain') ?? '', prevented: event.defaultPrevented };
      };
      const svgRange = document.createRange(); svgRange.selectNodeContents(svg);
      const svgCopy = copy(svgRange, svg);
      const allRange = document.createRange(); allRange.selectNodeContents(container);
      const fullCopy = copy(allRange, container);
      const glyphs = [...svg.querySelectorAll('[data-run]')];
      const selectedStyle = getComputedStyle(glyphs[0], '::selection');
      const selectionColors = { background: selectedStyle.backgroundColor, color: selectedStyle.color, fill: selectedStyle.fill };
      const first = glyphs[3]; const last = glyphs[Math.min(45, glyphs.length - 1)];
      const partialRange = document.createRange(); partialRange.setStart(first.firstChild!, 0);
      partialRange.setEnd(last.firstChild!, last.firstChild!.textContent!.length);
      const partialCopy = copy(partialRange, svg);
      // data-run is the grapheme index; summing UTF-16 lengths agrees with the source anchor convention.
      const segments = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(pageText)];
      const from = Number(first.getAttribute('data-run')); const to = Number(last.getAttribute('data-run')) + 1;
      const expectedPartial = segments.slice(from, to).map((segment) => segment.segment).join('');
      selection.removeAllRanges();
      return { pageText, expectedPartial, svgCopy, fullCopy, partialCopy, selectionColors, sourceLength: normalized.length };
    });
    expect(actual.sourceLength).toBeGreaterThan(actual.pageText.length);
    expect(actual.svgCopy).toEqual({ text: actual.pageText, prevented: true });
    expect(actual.fullCopy).toEqual({ text: actual.pageText, prevented: true });
    expect(actual.partialCopy).toEqual({ text: actual.expectedPartial, prevented: true });
    expect(actual.selectionColors).toEqual({ background: 'rgb(255, 235, 59)', color: 'rgb(40, 47, 43)', fill: 'rgb(40, 47, 43)' });
    await rendered.evaluate((wrapper) => {
      const svg = wrapper.querySelector('svg')!;
      const range = document.createRange(); range.selectNodeContents(svg);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      (window as unknown as { copiedPage: unknown }).copiedPage = null;
      document.addEventListener('copy', (event) => {
        (window as unknown as { copiedPage: unknown }).copiedPage = {
          text: event.clipboardData?.getData('text/plain') ?? '', prevented: event.defaultPrevented,
        };
      }, { once: true });
    });
    await page.keyboard.press('Control+c');
    const nativeCopy = await page.evaluate(() => (window as unknown as { copiedPage: unknown }).copiedPage);
    expect(nativeCopy).toEqual({ text: actual.pageText, prevented: true });
  }
});

test('a gaiji inside ruby retains both its image description and reading for screen readers', async ({ page }) => {
  await page.route('**/data/books/000624.json', async route => {
    const response = await route.fetch();
    const book = await response.json() as Book;
    const block = book.blocks.find(block => block.rubies.some(ruby => ruby.reading === 'かくりゃく'))!;
    const ruby = block.rubies.find(ruby => ruby.reading === 'かくりゃく')!;
    // The corpus now contains Unicode gaiji. Inject the former BMP image fallback
    // without shifting the ruby, so this accessibility case remains covered.
    expect(block.text.slice(ruby.start, ruby.start + 1)).toBe('虢');
    block.text = block.text.slice(0, ruby.start) + '\ufffc' + block.text.slice(ruby.start + 1);
    block.inlineImages = [{
      start: ruby.start, end: ruby.start + 1, src: 'data/images/0ec5460b77a424bd.png',
      sourceUrl: 'https://www.aozora.gr.jp/gaiji/1-91/1-91-48.png',
      alt: '※(「埒のつくり＋虎」、第3水準1-91-48)',
    }];
    await route.fulfill({ response, json: book });
  });
  await page.goto('/#/read/000624');
  const rendered = page.getByTestId('reader-page');
  await expect(rendered.locator('svg')).toBeVisible();
  const ruby = rendered.locator('.reader-accessible-text ruby').filter({ has: page.locator('[role="img"]') }).first();
  // The settings pane reduces the page height on mobile; reach the passage
  // containing the gaiji rather than assuming it is on the first page.
  await expect(page.locator('.reader-loading')).toHaveCount(0);
  for (let turns = 0; turns < 10 && await ruby.count() === 0; turns++) {
    const end = await rendered.getAttribute('data-end');
    await page.getByRole('button', { name: '次のページ', exact: true }).click();
    await expect(rendered).toHaveAttribute('data-start', end!);
    await expect(page.locator('.reader-loading')).toHaveCount(0);
  }
  await expect(ruby.locator('[role="img"]')).toHaveAttribute('aria-label', '※(「埒のつくり＋虎」、第3水準1-91-48)');
  await expect(ruby.locator('rt')).toHaveText('かくりゃく');
  await expect(ruby).not.toContainText('\ufffc');
});
