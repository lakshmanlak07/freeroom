import { defineConfig, devices } from '@playwright/test';

/** Runs against any deployment: BASE_URL=https://… pnpm --filter @freeroom/e2e smoke */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // one shared story: reserve → claim → approve → reveal
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    // CI: no traces (they record typed values, i.e. test logins); screenshots only.
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Phone profiles run the golden-path smoke. iPhone 14 is emulated in Chromium (size, DPR,
    // touch, UA); add a WebKit project once that browser is installed in CI.
    {
      name: 'iphone-14',
      testMatch: /smoke.spec/,
      use: { ...devices['iPhone 14'], browserName: 'chromium', defaultBrowserType: 'chromium' },
    },
    { name: 'pixel-7', testMatch: /smoke.spec/, use: { ...devices['Pixel 7'] } },
  ],
});
