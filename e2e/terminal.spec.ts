import { test, expect } from '@playwright/test';

test.describe('Terminal page', () => {
  test.beforeEach(async ({ page }) => {
    // Inject before navigation so no live cluster is needed
    await page.addInitScript(() => localStorage.setItem('kubecmds-data-mode', 'snapshot'));
    await page.goto('/terminal');
  });

  test('sidebar renders', async ({ page }) => {
    await expect(page.locator('app-terminal-sidebar')).toBeVisible();
  });

  test('mode toggle is present', async ({ page }) => {
    // Not 'app-mode-toggle, .mode-toggle' — a comma is a union, and .mode-toggle
    // is the component's own root div, so that matched twice and tripped strict mode.
    await expect(page.locator('app-mode-toggle')).toBeVisible();
  });

  test('namespace chips area is present', async ({ page }) => {
    await expect(page.locator('app-namespace-chips')).toBeVisible();
  });

  // app-back-link is gone — top-nav replaced the hub-and-spoke model, so every
  // view is reachable directly and getting home means clicking the brand.
  test('brand link navigates home', async ({ page }) => {
    await page.locator('.top-nav .brand').click();
    await expect(page).toHaveURL(/\/$/);
  });
});
