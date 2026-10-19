import { generateIdentity } from '../src/identity.cjs'
import { legalVersionKey } from '../src/legal/documents'

/** Changelog version the specs pretend to have already read. Bump with the app. */
export const E2E_CHANGELOG_VERSION = '1.6.0'

/**
 * Discovery tag every seeded spec identity carries, on the server as well as in
 * localStorage. It is what makes a run's leftovers identifiable and purgeable:
 * spec identities are random keypairs with no id prefix, so the tag is the only
 * handle on them.
 */
export const E2E_TAG = 'e2e'

/**
 * Keys that dismiss every first-run OVERLAY for an identity. These are separate
 * from onboarding, and each one silently swallows every click on the page when
 * it is missing — a "What's New" modal at z-120 makes a peer context's feed
 * completely unclickable, and the test then fails with a baffling
 * "element(s) not found" instead of "a modal is in the way".
 *
 * Returns [key, value] PAIRS rather than doing the writing: these are used
 * inside page.addInitScript, whose function body is serialized and evaluated in
 * the browser, where an imported helper is simply not defined.
 */
export function firstRunOverlayKeys(orbitId: string): [string, string][] {
  return [
    ['gmatch_last_seen_changelog', E2E_CHANGELOG_VERSION],
    ['orbit_tour_v1:' + orbitId, JSON.stringify({ version: 1, index: 0, status: 'done' })],
    [
      'orbit_onboarding_v2:' + orbitId,
      JSON.stringify({
        version: 1,
        current: 'ready',
        completed: ['welcome', 'auth', 'profile', 'platform', 'feed', 'tune', 'cards', 'economy', 'games', 'ready'],
      }),
    ],
  ]
}

/**
 * Seed a returning-user state so E2E skips onboarding deterministically:
 * real Ed25519 identity (shell), age-verified (shell + idle store mirror),
 * setup-complete idle save with 4 starter tags.
 */
export async function seedApp(
  page: import('@playwright/test').Page,
  overrides: { points?: number } = {},
) {
  const identity = generateIdentity()
  const idleSave = {
    version: 3,
    points: overrides.points ?? 1000,
    totalEarned: 1000,
    xp: 0,
    clickCount: 0,
    critCount: 0,
    shards: 0,
    prestigeCount: 0,
    tags: [
      { name: 'gangbang', level: 1, selected: true, base: 10, income: 0, weight: 1 },
      { name: 'creampie', level: 1, selected: true, base: 10, income: 0, weight: 1 },
      { name: 'ahegao', level: 1, selected: true, base: 10, income: 0, weight: 1 },
      { name: 'pregnant', level: 1, selected: true, base: 10, income: 0, weight: 1 },
    ],
    gallery: [],
    caps: [],
    capsUsed: [],
    achievements: [],
    collectedOfflineEarnings: true,
    ageAccepted: true,
    defeated: 0,
    backgroundUrl: null,
    viewMode: 'single',
    setupComplete: true,
    userExcludes: [],
    lastSeenAt: Date.now(),
  }
  await page.addInitScript(
    ([id, save, LEGAL_KEY, overlayKeys, e2eTag]: [Record<string, unknown>, Record<string, unknown>, string, [string, string][], string]) => {
      localStorage.setItem('orbit_identity', JSON.stringify(id))
      localStorage.setItem('goonMatch_age_verified', 'true')
      // Legal acceptance gate (C.2): seeded with the CURRENT canonical key
      // (computed node-side; the browser context can't call our modules).
      localStorage.setItem('orbit_legal_accepted', LEGAL_KEY)
      // Non-default display name: the onboarding migration treats default
      // peer names as "never onboarded" and reopens the profile step.
      localStorage.setItem('orbit_display_name', 'E2E Tester')
      // The 'e2e' tag is the only thing distinguishing a throwaway spec
      // identity from a real user: generateIdentity() mints a random keypair
      // with no prefix, and the server creates the Users row as a side effect of
      // the first signed request. Without a marker, leftover rows render as
      // User_1da964 in the directory with no way to purge just them.
      // Passed IN, not referenced: this function body is serialized and
      // evaluated in the browser, where a module-level const is undefined —
      // and the resulting ReferenceError silently aborts the rest of this
      // script, leaving the app stuck on the age gate.
      localStorage.setItem('orbit_tags', JSON.stringify([e2eTag]))
      localStorage.setItem(`gmatch.save.v1:${id.orbitId}`, JSON.stringify(save))
      localStorage.setItem('gmatch.save.v1', JSON.stringify(save))
      // lastSeenAt must be load-time or the offline-earnings modal pops on
      // every journey (passive income accrues between seed and page load).
      save.lastSeenAt = Date.now()
      // The changelog key is NOT written here: it comes from firstRunOverlayKeys
      // below, so the version has exactly one owner (E2E_CHANGELOG_VERSION).
      // A stale literal here used to be overwritten by that loop anyway.
      // Onboarding + tour + changelog overlays (see firstRunOverlayKeys).
      for (const [k, v] of overlayKeys) localStorage.setItem(k, v)
    },
    [identity, idleSave, legalVersionKey(), firstRunOverlayKeys(identity.orbitId), E2E_TAG],
  )
  return identity
}

/**
 * Deterministic idle-feed mock: intercepts the booru DAPI proxies used by
 * fetchFeed (browser mode) and serves synthetic posts whose images answer
 * under /__e2e__/. Without this, idle journeys ride the health of external
 * mirrors (tbib/xbooru) — flaky in CI and slow to gate `imageReady`.
 */
export async function mockBooruFeed(page: import('@playwright/test').Page): Promise<void> {
  let n = 0
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  await page.route('**/booru/**', async (route) => {
    n += 1
    const post = {
      id: 900000 + n,
      file_url: `http://localhost:5273/__e2e__/foe-${n}.png`,
      tags: '1girl rating_explicit',
      rating: 'e',
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([post]) })
  })
  await page.route('**/__e2e__/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  })
}

/**
 * 404s that are a FEATURE-DETECTION SIGNAL, not a fault. The mail-mode probe
 * (utils/mail-mode.ts:3-10) deliberately hits `/api/pm`: on any current node
 * that route is retired and the 404 is how the client learns "courier sealed
 * mail is the only DM path". Guarding against it would make the probe a bug.
 */
export const EXPECTED_404_PROBES = [/\/api\/pm(\?|$)/]

/** Pass to `watchApiNetwork({ allow })` alongside the auth-status exemption. */
export function allowExpected(status: number, url: string): boolean {
  if (status === 401 || status === 403) return true
  return status === 404 && EXPECTED_404_PROBES.some((re) => re.test(url))
}

export interface ApiNetworkGuard {
  /** Every `/api/**` response observed — the non-vacuity counter. */
  apiCalls(): number
  /** `/api/**` responses that came back 4xx/5xx (method + path + status). */
  apiFailures(): string[]
  /** Requests that never got a response (aborted socket, refused, timeout). */
  requestFailures(): string[]
  /** Console errors + uncaught exceptions, e.g. a Vite 500 module reload. */
  pageErrors(): string[]
  /** Throws with everything collected, or returns void when clean. */
  assertClean(extra?: string): void
}

/**
 * Opt-in network guard. The dev 404 storm (every lobby/feed/users poll 404ing
 * because /api pointed at the blind courier) was invisible to assertions that
 * only look at pixels — this makes it a hard failure. Anything the test itself
 * stubs or blocks is not a failure, and non-/api traffic is ignored on
 * purpose: booru mirrors and P2P peers are allowed to be down.
 */
export function watchApiNetwork(
  page: import('@playwright/test').Page,
  opts: { allow?: (status: number, url: string) => boolean } = {},
): ApiNetworkGuard {
  let calls = 0
  const api: string[] = []
  const requests: string[] = []
  const errors: string[] = []
  // Chromium reports some answered requests (e.g. HEAD probes) as BOTH a
  // response and a requestfailed/aborted. If a response was already seen the
  // request did reach the server, so it is not a request failure.
  const responded = new Set<string>()

  page.on('response', (res) => {
    const url = res.url()
    if (!/\/api\//.test(url)) return
    calls += 1
    const key = `${res.request().method()} ${url}`
    responded.add(key)
    const status = res.status()
    if (status < 400) return
    if (opts.allow?.(status, url)) return
    api.push(`${status} ${key}`)
  })
  page.on('requestfailed', (req) => {
    if (!/\/api\//.test(req.url())) return
    const key = `${req.method()} ${req.url()}`
    if (responded.has(key)) return
    requests.push(`${key} (${req.failure()?.errorText ?? 'failed'})`)
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    // Chromium logs one "Failed to load resource: NNN" console error per
    // non-2xx response. That duplicates the `response` handler above, which
    // records the same failure with method + URL and honours `allow`. Keeping
    // it would make every allowed probe (e.g. the /api/pm mail-mode 404) an
    // unfilterable failure. Real console errors still surface here.
    if (msg.text().startsWith('Failed to load resource')) return
    const at = msg.location()
    errors.push(`console: ${msg.text()}${at?.url ? ` (${at.url})` : ''}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

  return {
    apiCalls: () => calls,
    apiFailures: () => api,
    requestFailures: () => requests,
    pageErrors: () => errors,
    assertClean(extra = '') {
      const problems = [
        ...api.map((f) => `  api:        ${f}`),
        ...requests.map((f) => `  request:    ${f}`),
        ...errors.map((f) => `  ${f}`),
      ]
      if (!problems.length) return
      throw new Error(
        `Network guard tripped${extra ? ` (${extra})` : ''}:\n${problems.join('\n')}`,
      )
    },
  }
}
