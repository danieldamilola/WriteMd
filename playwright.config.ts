import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // `out/main/index.js` is what package.json's "main" points at, and nothing
  // built it before. A fresh clone ran the specs against a missing bundle.
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    trace: 'on-first-retry'
  }
})
