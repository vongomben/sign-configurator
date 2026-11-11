import { expect, test } from '@playwright/test';
import { expectClean, trackPage } from './guard';

const PAGES = ['index.html', 'admin.html', 'debug.html', 'bend-test.html', 'spec.html'] as const;

for (const file of PAGES) {
  test(`${file} si apre senza errori di console o di rete`, async ({ page }) => {
    const track = trackPage(page);
    await page.goto(file, { waitUntil: 'load' });

    if (file === 'index.html') {
      await expect(page.locator('h1')).toHaveText('Neon sign configurator');
    }
    if (file === 'admin.html') {
      await expect(page.locator('h1')).toHaveText('Admin');
    }
    if (file === 'spec.html') {
      await expect(page.locator('#spec h1').first()).toBeVisible();
    }
    if (file === 'debug.html') {
      await expect(page.locator('#raster')).toHaveAttribute('data-ok', 'true');
      expect(track.wasmOk(), 'manifold.wasm non caricato').toBe(true);
    }
    if (file === 'bend-test.html') {
      await expect(page.locator('#download-arcs')).toBeEnabled();
      await expect(page.locator('#download-corners')).toBeEnabled();
      expect(track.wasmOk(), 'manifold.wasm non caricato').toBe(true);
    }

    expectClean(track.problems);
  });
}
