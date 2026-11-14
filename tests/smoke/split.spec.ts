import { expect, test, type Download } from '@playwright/test';
import { expectClean, trackPage } from './guard';

/** Nomi dei file di uno ZIP senza compressione, letti dalla directory centrale. */
function zipNames(bytes: Buffer): string[] {
  const names: string[] = [];
  let at = bytes.readUInt32LE(bytes.length - 6);
  const count = bytes.readUInt16LE(bytes.length - 12);
  for (let i = 0; i < count; i++) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50);
    const length = bytes.readUInt16LE(at + 28);
    names.push(bytes.subarray(at + 46, at + 46 + length).toString('utf8'));
    at += 46 + length;
  }
  return names;
}

async function bytesOf(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test('piatto di stampa: «Ciao Torino» si divide in pezzi, uno ZIP li contiene tutti', async ({ page }) => {
  const track = trackPage(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('index.html', { waitUntil: 'load' });
  await expect(page.locator('#preview-status')).toContainText('LED');
  const button = page.locator('#download-stl');
  // «Ciao» a 12 cm è largo 29 cm: sta sul piatto da 30 in un pezzo.
  await expect(button).toHaveAttribute('data-parts', '1');

  await page.locator('input[name="text"]').fill('Ciao Torino');
  await expect(button).toHaveAttribute('data-ready', 'ciao-torino-120mm-housing.stl');
  await expect(button).not.toHaveAttribute('data-parts', '1');
  const parts = Number(await button.getAttribute('data-parts'));
  expect(parts).toBeGreaterThanOrEqual(2);
  expect(parts).toBeLessThanOrEqual(4);

  await page.locator('[data-tool="size"]').click();
  await expect(page.locator('#size-overall')).toContainText(`prints in ${parts} parts`);
  await page.locator('#open-request').click();
  await expect(page.locator('#summary')).toContainText(`${parts} parts for a 300 × 300 mm bed`);
  await expect(button).toHaveText(`Download STL · ${parts} parts (.zip)`);

  const downloads: Download[] = [];
  page.on('download', (download) => {
    downloads.push(download);
  });
  await button.click();
  await expect.poll(() => downloads.length).toBe(1);
  expect(downloads[0]!.suggestedFilename()).toBe('ciao-torino-120mm.zip');
  const names = zipNames(await bytesOf(downloads[0]!));
  const expected: string[] = [];
  for (let i = 1; i <= parts; i++) expected.push(`ciao-torino-120mm-housing-${i}of${parts}.stl`);
  for (let i = 1; i <= parts; i++) expected.push(`ciao-torino-120mm-diffuser-${i}of${parts}.stl`);
  expect(names).toEqual(expected);

  expectClean(track.problems);
});
