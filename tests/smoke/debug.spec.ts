import { expect, type Page, test } from '@playwright/test';
import { expectClean, trackPage } from './guard';

async function expectGraph(page: Page): Promise<void> {
  const canvas = page.locator('#raster');
  await expect(canvas).toHaveAttribute('data-ok', 'true');
  expect(Number(await canvas.getAttribute('data-nodes'))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute('data-edges'))).toBeGreaterThan(0);
  await expect(page.locator('#measures')).toContainText('Nodi');
  await expect(page.locator('#measures')).toContainText('Archi');
  await expect(page.locator('#warnings li.error')).toHaveCount(0);
  await expect(page.locator('input[name="showGraph"]')).toBeChecked();
  await expect(page.locator('#legend')).toContainText('Nodi per grado');
  expect(await canvas.getAttribute('data-pairs')).toBeNull();
}

test('debug: cubo manifold e Ciao Torino con entrambi i font', async ({ page }) => {
  const track = trackPage(page);
  await page.goto('debug.html', { waitUntil: 'load' });

  await page.getByRole('button', { name: 'Test manifold' }).click();
  await expect(page.locator('#manifold-check')).toHaveText('vertici: 8, triangoli: 12');
  expect(track.wasmOk(), 'manifold.wasm non caricato').toBe(true);

  await expect(page.locator('input[name="text"]')).toHaveValue('Ciao Torino');
  await expectGraph(page);

  await page.locator('#raster').evaluate((canvas: HTMLCanvasElement) => {
    delete canvas.dataset.ok;
  });
  await page.locator('select[name="fontId"]').selectOption('neonderthaw');
  await expectGraph(page);

  for (const fontId of ['hershey-script-simplex', 'ems-allure']) {
    await page.locator('#raster').evaluate((canvas: HTMLCanvasElement) => {
      delete canvas.dataset.ok;
    });
    await page.locator('select[name="fontId"]').selectOption(fontId);
    await expectGraph(page);
    await expect(page.locator('#measures')).toContainText('tratto singolo');
  }

  expectClean(track.problems);
});
