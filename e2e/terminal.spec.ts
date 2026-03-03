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
    await expect(page.locator('app-mode-toggle, .mode-toggle')).toBeVisible();
  });

  test('namespace chips area is present', async ({ page }) => {
    await expect(page.locator('app-namespace-chips')).toBeVisible();
  });

  test('back link navigates home', async ({ page }) => {
    await page.locator('app-back-link a, .back-link').first().click();
    await expect(page).toHaveURL(/\//);
  });
});
