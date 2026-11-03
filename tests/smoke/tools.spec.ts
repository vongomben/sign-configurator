import { expect, test, type Page } from '@playwright/test';
import { expectClean, trackPage } from './guard';

const TOOLS = ['text', 'font', 'size', 'color', 'image', 'more'] as const;

async function expectNoScroll(page: Page): Promise<void> {
  const box = await page.evaluate(() => ({
    sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    sh: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    iw: window.innerWidth,
    ih: window.innerHeight,
  }));
  expect(box.sw).toBeLessThanOrEqual(box.iw + 1);
  expect(box.sh).toBeLessThanOrEqual(box.ih + 1);
}

for (const viewport of [
  { width: 390, height: 844, mobile: true },
  { width: 1280, height: 800, mobile: false },
] as const) {
  test(`strumenti a ${viewport.width}×${viewport.height}: Ciao, un foglio, misura L`, async ({ page }) => {
    const track = trackPage(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('index.html', { waitUntil: 'load' });
    await expect(page.locator('input[name="text"]')).toHaveValue('Ciao');
    await expect(page.locator('#preview-status')).toContainText('LED');
    await expectNoScroll(page);

    if (viewport.mobile) {
      await expect(page.locator('.pane:visible')).toHaveCount(0);
    } else {
      await expect(page.locator('.pane:visible')).toHaveCount(1);
      await expect(page.locator('.pane:visible')).toHaveAttribute('data-pane', 'text');
    }

    for (const tool of TOOLS) {
      await page.locator(`[data-tool="${tool}"]`).click();
      const visible = page.locator('.pane:visible');
      await expect(visible).toHaveCount(1);
      await expect(visible).toHaveAttribute('data-pane', tool);
      await expectNoScroll(page);
    }

    await page.locator('[data-tool="size"]').click();
    await page.locator('.size-chip[data-size="180"]').click();
    await expect(page.locator('input[name="heightMm"]')).toHaveValue('180');
    await page.locator('#open-request').click();
    await expect(page.locator('#summary')).toContainText('18 cm');
    await expect(page.locator('.pane:visible')).toHaveCount(1);
    await expect(page.locator('.pane:visible')).toHaveAttribute('data-pane', 'request');
    await expectNoScroll(page);

    if (viewport.mobile) {
      await page.locator('#sheet-close').click();
      await expect(page.locator('.pane:visible')).toHaveCount(0);
      await expect(page.locator('.sheet')).toBeHidden();
      await expectNoScroll(page);
    }

    expectClean(track.problems);
  });
}
