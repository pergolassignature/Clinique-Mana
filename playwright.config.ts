import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from 'vite'
import { E2E_ORIGIN, E2E_PORT } from './e2e/fixtures/origin'

/**
 * End-to-end tests against the local stack (`npm run db:reset` first: the specs sign in with the
 * seed logins). Structure from PS Hub's config (Chromium only, trace on retry, screenshot on
 * failure). Deviations: no remote URL fallback, and the app must point at a local Supabase; the dev
 * server is this worktree's own, on E2E_PORT (the shared 5173 server may serve another worktree).
 */
const { VITE_SUPABASE_URL = '' } = loadEnv('development', process.cwd(), 'VITE_')
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(VITE_SUPABASE_URL)) {
  throw new Error(`e2e runs against a local Supabase only; VITE_SUPABASE_URL is "${VITE_SUPABASE_URL}".`)
}

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One shared database: specs never run side by side.
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: E2E_ORIGIN,
    locale: 'fr-CA',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  timeout: 30_000,
  expect: { timeout: 5_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${E2E_PORT} --strictPort`,
    url: E2E_ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
