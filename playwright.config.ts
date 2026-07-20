import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: true,
  // Chromium uses software WebGL in CI; serializing tests avoids GPU
  // contention while keeping each test independently isolated.
  workers: 1,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-gl=swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    env: {
      ...process.env,
      VITE_BASE_PATH: '/',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: 'http://127.0.0.1:3000/',
  },
});
