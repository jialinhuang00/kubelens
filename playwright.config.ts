import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4200',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Drive the Chrome that is already installed, rather than downloading
        // Playwright's own ~90MB build. Chrome auto-updates, so the browser
        // under test drifts with it; that is the accepted trade for not keeping
        // a second copy on disk.
        channel: 'chrome',
        deviceScaleFactor: 5,
        launchOptions: {
          args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 4200,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
