import { expect, test } from '@playwright/test';
import type { Book } from '../src/types';

test('Kandata uses body-font Unicode and three full character positions with ruby', async ({ page }) => {
  await page.goto('/');
  const expected = await page.evaluate(async () => {
    const book = await fetch('data/books/000092.json').then(r => r.json());
    const block = book.blocks.find((block: { text: string }) => block.text.includes('犍陀多'));
    if (!block) throw new Error('犍陀多がUnicodeで取り込まれていません');
    const anchor = { blockId: block.id, offset: 0, context: block.text.slice(0, 40).replaceAll('犍', '\ufffc') };
    const previousVersion = book.conversion.sourcePlaceholderVersion;
    if (!previousVersion) throw new Error('旧外字画像版の読書位置を復元する情報がありません');
    localStorage.setItem('aozora-stone-reader:v1:record:000092', JSON.stringify({
      contentVersion: previousVersion, anchor,
      updatedAt: new Date().toISOString(), progress: 0,
      bookmarks: [{ id: 'old-gaiji', anchor, createdAt: new Date().toISOString(), excerpt: '旧外字のしおり' }],
    }));
    return { blockId: block.id, contentVersion: book.contentVersion };
  });
  // Start a new document so the storage adapter reads the seeded record afresh.
  await page.reload();
  await page.goto('/#/read/000092');
  const rendered = page.getByTestId('reader-page');
  for (const direction of ['tbRl', 'lrTb']) {
    if (direction === 'lrTb') await page.getByRole('button', { name: '横書きに切り替え' }).click();
    await expect(rendered.locator('svg')).toHaveAttribute('data-stone-direction', direction);
    await expect(page.locator('.reader-loading')).toHaveCount(0);
    await expect(rendered).toHaveAttribute('data-block', expected.blockId);
    await expect(rendered).toHaveAttribute('data-offset', '0');
    const ruby = rendered.locator('.reader-accessible-text ruby').filter({ hasText: '犍陀多' }).first();
    await expect(ruby).toContainText('かんだた');
    await expect(ruby.locator('[role="img"]')).toHaveCount(0);
    await expect(rendered.locator('svg image')).toHaveCount(0);
    const positions = await rendered.locator('svg [data-run]').evaluateAll((glyphs) => {
      const at = glyphs.findIndex(glyph => glyph.textContent === '犍');
      return glyphs.slice(at, at + 3).map(glyph => ({ text: glyph.textContent, x: Number(glyph.getAttribute('x')), y: Number(glyph.getAttribute('y')), font: glyph.getAttribute('font-family') }));
    });
    expect(positions.map(p => p.text).join('')).toBe('犍陀多');
    expect(new Set(positions.map(p => p.font)).size).toBe(1);
    expect(direction === 'tbRl' ? positions[1].y - positions[0].y : positions[1].x - positions[0].x).toBeCloseTo(20, 1);
    expect(direction === 'tbRl' ? positions[2].y - positions[1].y : positions[2].x - positions[1].x).toBeCloseTo(20, 1);
  }
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aozora-stone-reader:v1:record:000092')!).contentVersion)).toBe(expected.contentVersion);
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('aozora-stone-reader:v1:record:000092')!));
  expect(migrated.bookmarks).toHaveLength(1);
  expect(migrated.bookmarks[0]).toMatchObject({ id: 'old-gaiji', anchor: { blockId: expected.blockId, offset: 0 } });
  expect(migrated.bookmarks[0].anchor.context).toContain('犍陀多');
  expect(migrated.bookmarks[0].anchor.context).not.toContain('\ufffc');
});

test('an unmapped bitmap gaiji reserves one full character position in either direction', async ({ page }) => {
  await page.route('**/data/books/000127.json', async route => {
    const response = await route.fetch();
    const book = await response.json() as Book;
    const block = book.blocks.find(block => block.kind === 'paragraph' && block.text.includes('人'))!;
    const start = block.text.indexOf('人');
    // Keep the UTF-16 length and all existing ruby ranges, replacing one BMP character.
    block.text = block.text.slice(0, start) + '\ufffc' + block.text.slice(start + 1);
    block.inlineImages = [{
      start, end: start + 1, src: 'data/images/900b563597eb46d2.png',
      sourceUrl: 'https://example.invalid/unmapped-gaiji.png', alt: '変換できない外字の検証用画像',
    }];
    await route.fulfill({ response, json: book });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const book = await fetch('data/books/000127.json').then(r => r.json());
    const block = book.blocks.find((block: { inlineImages: unknown[] }) => block.inlineImages.length);
    localStorage.setItem('aozora-stone-reader:v1:record:000127', JSON.stringify({
      contentVersion: book.contentVersion,
      anchor: { blockId: block.id, offset: Math.max(0, block.inlineImages[0].start - 5), context: '' },
      updatedAt: new Date().toISOString(), progress: 0, bookmarks: [],
    }));
  });
  await page.reload();
  await page.goto('/#/read/000127');
  const rendered = page.getByTestId('reader-page');
  for (const direction of ['tbRl', 'lrTb']) {
    if (direction === 'lrTb') await page.getByRole('button', { name: '横書きに切り替え' }).click();
    await expect(rendered.locator('svg')).toHaveAttribute('data-stone-direction', direction);
    await expect(page.locator('.reader-loading')).toHaveCount(0);
    await expect(rendered.locator('svg image').first()).toBeVisible();
    const positions = await rendered.evaluate(async (wrapper) => {
      const book = await fetch('data/books/000127.json').then(response => response.json());
      const source = book.blocks.map((block: { text: string }) => block.text).join('\n');
      const text = source.slice(Number(wrapper.getAttribute('data-start')), Number(wrapper.getAttribute('data-end')));
      const graphemes = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)];
      const at = graphemes.findIndex(grapheme => grapheme.segment === '\ufffc');
      const svg = wrapper.querySelector('svg')!;
      const image = svg.querySelector('image')!;
      const glyph = (index: number) => {
        const element = svg.querySelector(`[data-run="${index}"]`)!;
        return { text: element.textContent, x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')), fontSize: Number(element.getAttribute('font-size')) };
      };
      return {
        before: glyph(at - 1), after: glyph(at + 1),
        image: { x: Number(image.getAttribute('x')), y: Number(image.getAttribute('y')), width: Number(image.getAttribute('width')), height: Number(image.getAttribute('height')) },
      };
    });
    const { before, after, image } = positions;
    expect(before.text).toBe('一');
    expect(after.text).toBe('の');
    expect(after.fontSize).toBe(before.fontSize);
    expect(image.width).toBe(before.fontSize);
    expect(image.height).toBe(before.fontSize);
    // SVG text bounds include font ascent/descent beyond its 1em character cell.
    // Verify the reserved advance and the actual image coordinates instead.
    const advance = direction === 'tbRl' ? after.y - before.y : after.x - before.x;
    expect(advance).toBeCloseTo(before.fontSize * 2, 3);
    if (direction === 'tbRl') {
      expect(image.x).toBeCloseTo(before.x, 3);
      expect(after.x).toBeCloseTo(before.x, 3);
      expect(image.y).toBeGreaterThanOrEqual(before.y);
      expect(image.y + image.height).toBeLessThanOrEqual(after.y);
    } else {
      expect(after.y).toBeCloseTo(before.y, 3);
      expect(image.x).toBeCloseTo(before.x + before.fontSize, 3);
      expect(image.x + image.width).toBeCloseTo(after.x, 3);
    }
  }
});
