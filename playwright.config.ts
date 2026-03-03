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
