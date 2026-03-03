import { test } from '@playwright/test';
import * as path from 'path';

const OUT = path.resolve(__dirname, '../docs');

async function applyOssyria(page: any) {
  await page.addInitScript(() => {
    localStorage.setItem('kubecmds-data-mode', 'snapshot');
    localStorage.setItem('kubecmds-theme', 'ossyria');
  });
}

/** Wait for graph data to load, then give WebGL time to render. */
async function waitForGraph(page: any) {
  // stats-badge appears once the API response is parsed
  await page.waitForSelector('.stats-badge', { timeout: 30_000 });
  // Give cosmos + requestAnimationFrame time to place nodes and compute boundaries
  await page.waitForTimeout(5_000);
}

test.describe('Documentation screenshots — Ossyria', () => {
  test.setTimeout(120_000);

  // 1. Universe overview
  test('01 universe overview', async ({ page }) => {
    await applyOssyria(page);
    await page.goto('/universe');
    await waitForGraph(page);
    await page.screenshot({ path: path.join(OUT, '01-universe-overview.png') });
  });

  // 2. Universe — maple-staging namespace selected
  test('02 universe maple-staging', async ({ page }) => {
    await applyOssyria(page);
    await page.goto('/universe');
    await waitForGraph(page);
    const chip = page.locator('app-namespace-chips button', { hasText: 'maple-staging' });
    await chip.waitFor({ timeout: 10_000 });
    await chip.click();
    await page.waitForTimeout(2_000); // zoom animation
    await page.screenshot({ path: path.join(OUT, '02-universe-target-ns.png') });
  });

  // 3. Terminal — maple-staging, 2 deployments + 2 pods open
  test('03 terminal', async ({ page }) => {
    await applyOssyria(page);
    await page.goto('/terminal');
    await page.waitForLoadState('networkidle');

    // Select maple-staging namespace
    const nsChip = page.getByRole('button', { name: 'maple-staging' });
    await nsChip.waitFor({ timeout: 20_000 });
    await nsChip.click();

    // Wait for resource tree to load (tree-group appears after namespace is selected)
    await page.waitForSelector('.tree-group', { timeout: 20_000 });
    await page.waitForTimeout(800);

    // Expand Deployments and open backend-api + edge-proxy
    const deployHeader = page.locator('.tree-group-header').filter({ hasText: 'Deployment' });
    await deployHeader.waitFor({ timeout: 5_000 });
    await deployHeader.click();
    await page.waitForSelector('.tree-item-name', { timeout: 8_000 });

    for (const name of ['backend-api', 'edge-proxy']) {
      const label = page.locator('.tree-item', { hasText: name }).first();
      await label.waitFor({ timeout: 5_000 });
      await label.locator('input[type="checkbox"]').check({ force: true });
      await page.waitForTimeout(300);
    }

    // Expand Pods and open 2 pods
    const podHeader = page.locator('.tree-group-header', { hasText: 'Pod' });
    await podHeader.click();
    await page.waitForTimeout(500);

    for (const name of ['log-agent-fc947f857-rpblv', 'edge-proxy-f467cc8f6-g9hnv']) {
      const label = page.locator('.tree-item', { hasText: name }).first();
      await label.waitFor({ timeout: 5_000 });
      await label.locator('input[type="checkbox"]').check({ force: true });
      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(1_000); // let panels settle

    // log-agent (pod index 2) → Details
    // edge-proxy-pod (pod index 3) → YAML
    const panels = page.locator('app-floating-panel');
    await panels.nth(2).locator('.toolbar-chip', { hasText: 'Details' }).click({ force: true });
    await page.waitForTimeout(600);
    await panels.nth(3).locator('.toolbar-chip', { hasText: 'YAML' }).click({ force: true });
    await page.waitForTimeout(1_200); // wait for snapshot output to render

    // Position panels: override Angular ngStyle left/top with !important
    //   [0] backend-api:    stays at top-left (anchor)
    //   [1] edge-proxy:     +440px right
    //   [2] log-agent: +200px right, +250px down
    //   [3] edge-proxy-pod: +460px right, +330px down
    await page.evaluate(() => {
      const els = document.querySelectorAll<HTMLElement>('.floating-panel');
      const positions: [number, number][] = [[0, 0], [440, 10], [200, 250], [460, 330]];
      els.forEach((el, i) => {
        const [x, y] = positions[i] ?? [0, 0];
        if (x === 0 && y === 0) return;
        const base = { x: 20, y: 20 }; // default panel open position
        el.style.setProperty('left', `${base.x + x}px`, 'important');
        el.style.setProperty('top',  `${base.y + y}px`, 'important');
      });
    });

    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '03-terminal.png') });
  });

  // 4. Export panel
  test('04 export', async ({ page }) => {
    await applyOssyria(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const exportBtn = page.getByRole('button', { name: /Export Snapshot/i });
    if (await exportBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await exportBtn.click();
      await page.waitForSelector('.export-panel', { timeout: 5_000 });
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: path.join(OUT, '04-export.png') });
  });

  // 5. Home
  test('05 home', async ({ page }) => {
    await applyOssyria(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(OUT, '05-home.png') });
  });
});
