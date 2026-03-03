import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows title', async ({ page }) => {
    await expect(page.locator('h1.title')).toHaveText('kubecmds-viz');
  });

  test('shows mode toggle buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Realtime' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Snapshot' })).toBeVisible();
  });

  test('shows navigation cards', async ({ page }) => {
    await expect(page.locator('.card-label', { hasText: 'Terminal' })).toBeVisible();
    await expect(page.locator('.card-label', { hasText: 'Graph' })).toBeVisible();
  });

  test('Terminal card navigates to /terminal', async ({ page }) => {
    await page.locator('a.card', { hasText: 'Terminal' }).click();
    await expect(page).toHaveURL(/\/terminal/);
  });

  test('Graph card navigates to /universe', async ({ page }) => {
    await page.locator('a.card', { hasText: 'Graph' }).click();
    await expect(page).toHaveURL(/\/universe/);
  });

  test('theme switcher is visible', async ({ page }) => {
    await expect(page.locator('.theme-switcher')).toBeVisible();
  });
});
