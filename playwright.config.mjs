import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests/browser',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    launchOptions: existsSync('/opt/google/chrome/chrome')
      ? { executablePath: '/opt/google/chrome/chrome' }
      : {},
  },
  webServer: {
    command: 'node tests/server.mjs',
    url: 'http://127.0.0.1:5173/tests/fixtures/demo.html',
    reuseExistingServer: !process.env.CI,
  },
});
