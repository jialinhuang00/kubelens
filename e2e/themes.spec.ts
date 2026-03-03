import { test, expect } from '@playwright/test';

const THEMES = [
  { id: 'default',     label: 'Henesys',     attr: null },
  { id: 'lith-harbor', label: 'Lith Harbor', attr: 'lith-harbor' },
  { id: 'ellinia',     label: 'Ellinia',      attr: 'ellinia' },
  { id: 'perion',      label: 'Perion',       attr: 'perion' },
  { id: 'ossyria',     label: 'Ossyria',      attr: 'ossyria' },
];

test.describe('Theme switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Reset to default theme
    await page.evaluate(() => localStorage.removeItem('kubecmds-theme'));
    await page.reload();
  });

  for (const theme of THEMES) {
    test(`applies ${theme.label} theme`, async ({ page }) => {
      // Open theme dropdown
      await page.locator('.theme-btn').click();
      await expect(page.locator('.theme-dropdown')).toBeVisible();

      // Click the theme option
      await page.locator('.theme-option', { hasText: theme.label }).click();

      // Dropdown closes
      await expect(page.locator('.theme-dropdown')).not.toBeVisible();

      // Verify data-theme attribute on <html>
      if (theme.attr) {
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme.attr);
      } else {
        // default theme removes the attribute
        await expect(page.locator('html')).not.toHaveAttribute('data-theme');
      }

      // Verify localStorage persisted the choice
      const stored = await page.evaluate(() => localStorage.getItem('kubecmds-theme'));
      expect(stored).toBe(theme.id);

      // Screenshot for visual record
      await page.screenshot({ path: `e2e/screenshots/theme-${theme.id}.png`, fullPage: false });
    });
  }

  test('persists theme on reload', async ({ page }) => {
    await page.locator('.theme-btn').click();
    await page.locator('.theme-option', { hasText: 'Ellinia' }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ellinia');
  });
});
