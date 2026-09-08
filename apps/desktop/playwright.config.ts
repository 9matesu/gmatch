import { defineConfig, devices } from '@playwright/test'

// E2E runs against the vite dev server (browser mode). The dev-api plugin
// auto-spawns the Bun sidecar on 8790, so the full stack is live.
// Port 5273 (not 5173): a foreign vite on 5173 + reuseExistingServer would
// silently run every journey against SOME OTHER APP (seen: a random site's
// page answered /#/admin). strictPort guarantees we serve our own bundle.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../../node_modules/vite/bin/vite.js --port 5273 --strictPort',
    url: 'http://localhost:5273',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { TMPDIR: '/i/tmp', TEMP: 'I:/tmp', TMP: 'I:/tmp' },
  },
})
