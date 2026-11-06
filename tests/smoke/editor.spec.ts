import { expect, test, type Page } from '@playwright/test';
import { expectClean, trackPage } from './guard';

interface Pin {
  pathId: string;
  index: number;
  x: number;
  y: number;
}

async function pinsOf(page: Page): Promise<Pin[]> {
  const raw = await page.locator('#path-editor').getAttribute('data-nodes');
  return JSON.parse(raw ?? '[]') as Pin[];
}

function middlePin(pins: Pin[]): Pin {
  const groups = new Map<string, Pin[]>();
  for (const pin of pins) {
    const list = groups.get(pin.pathId) ?? [];
    list.push(pin);
    groups.set(pin.pathId, list);
  }
  let best: Pin[] = [];
  for (const list of groups.values()) if (list.length > best.length) best = list;
  best.sort((a, b) => a.index - b.index);
  const pin = best[Math.floor(best.length / 2)];
  if (!pin) throw new Error('nessun nodo');
  return pin;
}

test('editor: trascina un nodo, una curva stretta blocca l\'invio, Ctrl+Z lo riabilita', async ({ page }) => {
  test.setTimeout(240_000);
  const track = trackPage(page);
  const scripts: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('.js')) scripts.push(url);
  });

  await page.goto('index.html', { waitUntil: 'load' });
  await expect(page.locator('#preview-status')).toContainText('LED');
  expect(scripts.join('\n').toLowerCase()).not.toContain('paper');

  await page.locator('input[name="text"]').fill('c');
  await page.locator('input[name="heightMm"]').fill('560');
  await page.locator('input[name="heightMm"]').dispatchEvent('change');
  await page.locator('#open-request').click();
  await expect(page.locator('#submit-order')).toBeEnabled();
  await page.locator('#sheet-close').click();

  const canvas = page.locator('#path-editor');
  const status = page.locator('#preview-status');
  const beforeOpen = await status.getAttribute('data-generation');
  await page.locator('#edit-paths').click();
  await expect(canvas).toHaveAttribute('data-open', 'true');
  await canvas.scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const box = await canvas.boundingBox();
    if (!box || box.height < 100) return false;
    const pins = await pinsOf(page);
    return pins.some((pin) => pin.x > box.x + 4 && pin.x < box.x + box.width - 4 && pin.y > box.y + 4 && pin.y < box.y + box.height - 4);
  }).toBe(true);
  await expect.poll(async () => status.getAttribute('data-generation')).not.toBe(beforeOpen);
  await expect(page.locator('#submit-order')).toBeEnabled();

  const beforeDrag = await status.getAttribute('data-generation');
  const first = middlePin(await pinsOf(page));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(first.x + 6, first.y + 4, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => status.getAttribute('data-generation')).not.toBe(beforeDrag);
  await expect(page.locator('#submit-order')).toBeEnabled();

  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas');
  const node = middlePin(await pinsOf(page));
  const margin = 12;
  let targetX = box.x + box.width / 2;
  let targetY = box.y + box.height / 2;
  if (Math.hypot(targetX - node.x, targetY - node.y) < 50) {
    targetX = box.x + margin;
    targetY = box.y + margin;
  }
  targetX = Math.min(box.x + box.width - margin, Math.max(box.x + margin, targetX));
  targetY = Math.min(box.y + box.height - margin, Math.max(box.y + margin, targetY));
  await page.mouse.move(node.x, node.y);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 12 });
  await page.mouse.up();
  await page.locator('#open-request').click();
  await expect(page.locator('#submit-order')).toBeDisabled();

  await page.locator('#sheet-close').click();
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await page.locator('#open-request').click();
  await expect(page.locator('#submit-order')).toBeEnabled();
  expectClean(track.problems);
});
