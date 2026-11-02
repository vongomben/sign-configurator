import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { expectClean, trackPage } from './guard';

const PIECES = [
  { id: '#download-arcs', label: 'A' },
  { id: '#download-corners', label: 'B' },
] as const;

test('bend-test: gli STL dei pezzi A e B non sono vuoti', async ({ page }) => {
  const track = trackPage(page);
  await page.goto('bend-test.html', { waitUntil: 'load' });
  await expect(page.locator('#download-arcs')).toBeEnabled();
  await expect(page.locator('#download-corners')).toBeEnabled();
  expect(track.wasmOk(), 'manifold.wasm non caricato').toBe(true);

  for (const piece of PIECES) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(piece.id).click(),
    ]);
    const path = await download.path();
    expect(path, `STL ${piece.label} senza file`).toBeTruthy();
    const bytes = readFileSync(path!);
    expect(bytes.length, `STL ${piece.label} vuoto`).toBeGreaterThan(84);
    const triangles = bytes.readUInt32LE(80);
    expect(triangles, `STL ${piece.label} senza triangoli`).toBeGreaterThan(0);
    expect(bytes.length).toBe(84 + triangles * 50);
  }

  expectClean(track.problems);
});
