import { test, expect } from '@playwright/test';

test.describe('Universe (graph) page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('kubelens-data-mode', 'snapshot'));
    await page.goto('/universe');
  });

  test('canvas element renders', async ({ page }) => {
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('sidebar is visible', async ({ page }) => {
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('stats badge appears after graph loads', async ({ page }) => {
    // Stats badge shows total node count once data is fetched
    await expect(page.locator('.stats-badge')).toBeVisible({ timeout: 15_000 });
  });

  test('namespace chips appear after graph loads', async ({ page }) => {
    await expect(page.locator('app-namespace-chips')).toBeVisible({ timeout: 15_000 });
  });

  test('namespace boundaries overlay renders after graph loads', async ({ page }) => {
    // Boundaries are divs with class ns-boundary rendered over the canvas
    await page.waitForSelector('.ns-boundary', { timeout: 20_000 });
    const count = await page.locator('.ns-boundary').count();
    expect(count).toBeGreaterThan(0);
  });

  // app-back-link is gone — top-nav replaced the hub-and-spoke model, so every
  // view is reachable directly and getting home means clicking the brand.
  test('brand link navigates home', async ({ page }) => {
    await page.locator('.top-nav .brand').click();
    await expect(page).toHaveURL(/\/$/);
  });
});
