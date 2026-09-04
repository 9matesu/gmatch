import { defineConfig, devices } from '@playwright/test'

// E2E runs against the vite dev server (browser mode). The dev-api plugin
// auto-spawns the Bun sidecar on 8790, so the full stack is live.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../../node_modules/vite/bin/vite.js --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { TMPDIR: '/i/tmp', TEMP: 'I:/tmp', TMP: 'I:/tmp' },
  },
})
