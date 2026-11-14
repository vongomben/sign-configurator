import { expect, test } from '@playwright/test';
import { expectClean, trackPage } from './guard';

test('Tecnica: il canale segue la striscia, e un canale troppo stretto lo dice', async ({ page }) => {
  const track = trackPage(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('index.html', { waitUntil: 'load' });
  await expect(page.locator('#preview-status')).toContainText('LED');
  await page.locator('[data-tool="tech"]').click();

  const stripW = page.locator('input[name="tech-STRIP_W"]');
  const stripT = page.locator('input[name="tech-STRIP_T"]');
  const channelW = page.locator('input[name="tech-CHANNEL_W"]');
  const channelD = page.locator('input[name="tech-CHANNEL_DEPTH"]');
  const slotW = page.locator('input[name="tech-WIRE_SLOT_W"]');
  await expect(channelW).toHaveValue('10.4');

  // La striscia si restringe: canale e asola la seguono, con la tolleranza di 0,4 mm.
  await stripW.fill('5');
  await expect(channelW).toHaveValue('5.4');
  await expect(slotW).toHaveValue('5.4');

  // Lo spessore comanda la profondità, più i 6 mm d'aria sopra i LED.
  await stripT.fill('2');
  await expect(channelD).toHaveValue('8');

  // Toccato a mano, il canale smette di seguire.
  await channelW.fill('7');
  await stripW.fill('8');
  await expect(channelW).toHaveValue('7');
  await expect(stripW).toHaveValue('8');

  // Ora la striscia non ci sta: la pagina lo dice invece di accettarlo in silenzio.
  await expect(page.locator('#preview-status')).toContainText('narrower than the LED strip', { timeout: 60_000 });

  // Reset: tutto torna ai valori del profilo e l'avviso sparisce.
  await page.locator('#tech-reset').click();
  await expect(stripW).toHaveValue('10');
  await expect(channelW).toHaveValue('10.4');
  await expect(page.locator('#preview-status')).not.toContainText('narrower', { timeout: 60_000 });

  expectClean(track.problems);
});
