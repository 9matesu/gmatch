import { defineConfig, devices } from '@playwright/test'

// E2E runs against the vite dev server (browser mode). The dev-sidecar plugin
// in vite.config.ts boots the same Bun API the packaged app uses, so the full
// stack is live and /api answers a FULL node — never the central courier,
// which 404s every stateful route by design (see e2e/api-network.spec.ts).
// Port 5273 (not 5173): a foreign vite on 5173 + reuseExistingServer would
// silently run every journey against SOME OTHER APP (seen: a random site's
// page answered /#/admin). strictPort guarantees we serve our own bundle.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  // One worker, on purpose. Every spec drives the SAME node: they publish
  // posts, like them, join rooms and read notifications out of one database.
  // Playwright's default (half the CPU count) ran 11 browsers against one
  // Bun sidecar, which thrashes it into 431s/ECONNABORTED and cascades into
  // mass failures that look like product bugs. Serial also makes the
  // "reload and the room is still there" journeys deterministic.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../../node_modules/vite/bin/vite.js --port 5273 --strictPort',
    url: 'http://localhost:5273',
    reuseExistingServer: false,
    // Fresh schema + VACUUM on a cold DB is slower than the default budget.
    timeout: 120_000,
    env: {
      TMPDIR: '/i/tmp',
      TEMP: 'I:/tmp',
      TMP: 'I:/tmp',
      // Hermetic sidecar: own port (never the dev session's 8790) and a
      // throwaway DB, wiped before the node boots so a run can neither mutate
      // nor be broken by local dev data, and leftover rows never leak between
      // runs. Wiping is opt-in via GMATCH_API_FRESH and happens in the vite
      // plugin, which owns the sidecar's data dir.
      GMATCH_API_PORT: '8791',
      GMATCH_API_FRESH: '1',
      SNAPSHOT_PATH: 'I:/tmp/gmatch-e2e/orbit.sqlite',
      WATCH_PARTIES_PATH: 'I:/tmp/gmatch-e2e/watchparties.json',
      BLOB_STORE_DIR: 'I:/tmp/gmatch-e2e/blobs',
      STORAGE_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      // Pin the admin console for the run. Two reasons: the dev sidecar's
      // default is the literal "admin", and a developer's own
      // apps/api/.env.local (Bun loads it from this cwd) would otherwise
      // override it — so the run silently inherited whatever PIN the machine
      // had. Set here, the parent env wins and the suite is hermetic.
      // Test-only value for a throwaway database; not a real secret.
      ADMIN_PIN: 'e2e-admin-pin',
    },
  },
})
