/**
 * Two-instance sealed-mail E2E against a REAL blind courier.
 *
 * Both instances run against one sidecar booted with SITE_SERVICES=mail,turn,
 * admin — the onrender-courier topology, where /api/users, /api/users/online
 * and /api/servers/dashboard all 404. The ONLY way two strangers find each
 * other out here is the presence-beacon roster: each instance signs a beacon
 * (Ed25519 + X25519 keys inside), fetches the roster, and the app must feed
 * those verified keys into the TOFU registry (first outbound seal) and the
 * presence store (the chat player list) — both wiring points live in App.tsx.
 *
 * The round trip proves the whole chain: beacons → roster → key registration
 * → sealed 1-to-1 envelope → courier relay → WS push → reply → delivery.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIdentity } from '../src/identity.cjs';
import { legalVersionKey } from '../src/legal/documents';

const COURIER_PORT = 8792;
const COURIER_BASE = `http://localhost:${COURIER_PORT}`;
const COURIER_DATA = resolve('I:/tmp/gmatch-e2e-courier');
const API_DIR = resolve(fileURLToPath(import.meta.url), '../../../api');

// Same resolution order the vite plugin uses (vite.config.ts) — a machine
// without bun on PATH still finds the per-user install.
function resolveBun(): string {
  const candidates = [
    join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
    join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'),
  ].filter((p) => p && existsSync(p));
  return candidates[0] || 'bun';
}

let courier: ChildProcess | null = null;

async function waitForCourier(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${COURIER_BASE}/api/health`);
      if (res.ok) {
        const body = (await res.json()) as { mode?: string; db_ready?: boolean };
        // The health endpoint itself is allowed through the gate; a courier
        // answers mode:'courier'. Anything else is not the node under test.
        if (body.mode === 'courier' && body.db_ready) return;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`courier sidecar did not become ready on :${COURIER_PORT}`);
}

// The hook timeout must exceed the cold-schema+VACUUM cost — the same reason
// the vite webServer budget is 120s (playwright.config.ts).
test.beforeAll(async () => {
  rmSync(COURIER_DATA, { recursive: true, force: true });
  // The vite plugin creates the data dir for the full sidecar; here we own
  // it — libsql cannot create the sqlite file inside a missing directory.
  mkdirSync(COURIER_DATA, { recursive: true });
  courier = spawn(resolveBun(), ['run', 'src/serve.ts'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      PORT: String(COURIER_PORT),
      SITE_SERVICES: 'mail,turn,admin',
      SNAPSHOT_PATH: join(COURIER_DATA, 'orbit.sqlite'),
      BLOB_STORE_DIR: join(COURIER_DATA, 'blobs'),
      WATCH_PARTIES_PATH: join(COURIER_DATA, 'watchparties.json'),
      STORAGE_ENCRYPTION_KEY: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    },
    stdio: 'ignore',
  });
  // Readiness is awaited inside the test (this Playwright ignores the
  // beforeAll timeout overload): cold schema+VACUUM can exceed the 30s
  // hook budget, the same reason the vite webServer budget is 120s.
}, 30_000);

test.afterAll(async () => {
  courier?.kill();
  // Windows holds the sqlite handle briefly after kill; best effort.
  await new Promise((r) => setTimeout(r, 1_000));
  rmSync(COURIER_DATA, { recursive: true, force: true });
});

/**
 * Seed a returning user pointed at the courier. Same shape as seedApp but
 * with a distinct name and the manual api-base override the courier test
 * needs (the vite-proxied sidecar on 8791 is a FULL node — this spec must
 * not touch it).
 */
async function openInstance(
  browser: Browser,
  identity: ReturnType<typeof generateIdentity>,
  displayName: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(
    ([id, name, legalKey]: [Record<string, unknown>, string, string]) => {
      localStorage.setItem('orbit_identity', JSON.stringify(id));
      localStorage.setItem('goonMatch_age_verified', 'true');
      localStorage.setItem('orbit_legal_accepted', legalKey);
      localStorage.setItem('orbit_display_name', name);
      localStorage.setItem('orbit_tags', JSON.stringify(['e2e']));
      // Route EVERYTHING (mail, presence, WS) at the blind courier. This is
      // what makes the run courier-mode despite localhost: the mail-mode
      // probe (HEAD /api/pm → 404) decides courier vs legacy, not the host.
      localStorage.setItem('gmatch.api.url', 'http://localhost:8792');
      localStorage.setItem('gmatch_last_seen_changelog', '1.6.0');
      localStorage.setItem(
        'orbit_onboarding_v2:' + id.orbitId,
        JSON.stringify({
          version: 1,
          current: 'ready',
          completed: ['welcome', 'auth', 'profile', 'platform', 'feed', 'tune', 'cards', 'economy', 'games', 'ready'],
        }),
      );
    },
    [identity as unknown as Record<string, unknown>, displayName, legalVersionKey()],
  );
  await page.goto('/');
  return { context, page };
}

/** Open the messages view and wait until the peer is listable. */
async function openDmTo(page: Page, peerName: string): Promise<void> {
  await page.goto('/#/messages');
  // The player list is fed by the presence store; on the courier its poller
  // 404s, so the ONLY source is the beacon roster we ingest in App.tsx.
  const row = page.getByTestId('chat-player-list').getByText(peerName, { exact: true });
  await expect(row).toBeVisible({ timeout: 120_000 });
  await row.click();
  // The player row opens the profile modal; its Message button starts the PM.
  await page.getByRole('button', { name: 'Message' }).click();
}

test.fixme(
  'two instances bootstrap sealed DMs from presence beacons alone',
  'WIP: the courier sidecar boots and both instances open, but the beacon roster never reaches the chat player list yet. Fixed along the way: App.tsx feeds roster keys into the TOFU registry and ingests the roster into the presence store; useP2P now detects swarm-couriers via /api/health mode instead of the onrender hostname; computeApiBase honors gmatch.api.url on localhost. Next: instrument in-page (dump the roster response and the presence store) to find where the chain still drops.',
  async ({ browser }) => {
  test.setTimeout(300_000);
  // Cold schema+VACUUM on a brand-new database — same budget rationale as
  // the vite webServer's 120s, plus margin for the two beacon cycles below.
  await waitForCourier(150_000);
  const alice = generateIdentity();
  const bob = generateIdentity();

  const aliceSession = await openInstance(browser, alice, 'Alice Courier');
  const bobSession = await openInstance(browser, bob, 'Bob Courier');
  const { page: alicePage } = aliceSession;
  const { page: bobPage } = bobSession;

  // Give the first beacon + roster cycle room; both sides should see each
  // other within ~2 cycles (beacon on mount, roster immediate + 60s).
  await openDmTo(alicePage, 'Bob Courier');
  await openDmTo(bobPage, 'Alice Courier');

  // Alice seals and sends the first outbound DM — impossible without the
  // TOFU keys learned from Bob's beacon.
  await alicePage.getByLabel('Write a message').fill('hello bob, sealed from the courier');
  await alicePage.getByLabel('Write a message').press('Enter');
  await expect(
    bobPage.getByText('hello bob, sealed from the courier').first(),
  ).toBeVisible({ timeout: 60_000 });

  // Bob replies; the reply must reach Alice through the same sealed path.
  await bobPage.getByLabel('Write a message').fill('hey alice — received and sealed back');
  await bobPage.getByLabel('Write a message').press('Enter');
  await expect(
    alicePage.getByText('hey alice — received and sealed back').first(),
  ).toBeVisible({ timeout: 60_000 });

  await aliceSession.context.close();
  await bobSession.context.close();
  },
);
