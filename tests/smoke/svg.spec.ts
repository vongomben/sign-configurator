import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectClean, trackPage } from './guard';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'linea.svg');

test('debug: un SVG caricato produce l\'STL', async ({ page }) => {
  const track = trackPage(page);
  await page.goto('debug.html', { waitUntil: 'load' });
  await expect(page.locator('#raster')).toHaveAttribute('data-ok', 'true');

  await page.locator('select[name="sourceKind"]').selectOption('image');
  await page.locator('input[name="image"]').setInputFiles(fixture);
  await expect(page.locator('#solid-status')).toContainText('linea.svg');
  await expect(page.locator('#download-housing')).toBeEnabled();

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-housing').click()]);
  const path = await download.path();
  expect(path, 'STL senza file').toBeTruthy();
  const bytes = readFileSync(path!);
  expect(bytes.length).toBeGreaterThan(84);
  const triangles = bytes.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(0);
  expect(bytes.length).toBe(84 + triangles * 50);

  expectClean(track.problems);
});
