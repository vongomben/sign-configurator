import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { expectClean, trackPage } from './guard';

async function inViewport(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  expect(box, selector).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function bytesOf(download: Download): Promise<number> {
  const path = await download.path();
  expect(path).toBeTruthy();
  const data = await readFile(path!);
  return data.byteLength;
}

test('index: Scarica STL di Ciao Torino, housing e diffusore', async ({ page }) => {
  const track = trackPage(page);
  await page.goto('index.html', { waitUntil: 'load' });
  const button = page.locator('#download-stl');
  await page.locator('input[name="text"]').fill('Ciao Torino');
  await expect(button).toHaveAttribute('data-ready', 'ciao-torino-120mm-housing.stl');
  await expect(button).toBeEnabled();
  await expect(button).toHaveText('Scarica STL');
  await inViewport(page, '#download-stl');
  await page.setViewportSize({ width: 390, height: 844 });
  await inViewport(page, '#download-stl');
  await page.setViewportSize({ width: 1280, height: 720 });

  const downloads: Download[] = [];
  page.on('download', (download) => {
    downloads.push(download);
  });
  await button.click();
  await expect.poll(() => downloads.length).toBe(2);

  const byName = new Map<string, Download>();
  for (const download of downloads) byName.set(download.suggestedFilename(), download);
  const housing = byName.get('ciao-torino-120mm-housing.stl');
  const diffuser = byName.get('ciao-torino-120mm-diffuser.stl');
  expect(housing).toBeTruthy();
  expect(diffuser).toBeTruthy();
  expect(await bytesOf(housing!)).toBeGreaterThan(84);
  expect(await bytesOf(diffuser!)).toBeGreaterThan(84);
  expectClean(track.problems);
});
