import { generateIdentity } from '../src/identity.cjs'
import { legalVersionKey } from '../src/legal/documents'

/**
 * Seed a returning-user state so E2E skips onboarding deterministically:
 * real Ed25519 identity (shell), age-verified (shell + idle store mirror),
 * setup-complete idle save with 4 starter tags.
 */
export async function seedApp(
  page: import('@playwright/test').Page,
  overrides: { gc?: number } = {},
) {
  const identity = generateIdentity()
  const idleSave = {
    version: 3,
    gc: overrides.gc ?? 1000,
    credited: 0,
    debited: 0,
    totalEarnedGc: 1000,
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
    ([id, save, LEGAL_KEY]: [Record<string, unknown>, Record<string, unknown>, string]) => {
      localStorage.setItem('orbit_identity', JSON.stringify(id))
      localStorage.setItem('goonMatch_age_verified', 'true')
      // Legal acceptance gate (C.2): seeded with the CURRENT canonical key
      // (computed node-side; the browser context can't call our modules).
      localStorage.setItem('orbit_legal_accepted', LEGAL_KEY)
      // Non-default display name: the onboarding migration treats default
      // peer names as "never onboarded" and reopens the profile step.
      localStorage.setItem('orbit_display_name', 'E2E Tester')
      localStorage.setItem('orbit_tags', JSON.stringify(['e2e']))
      localStorage.setItem(`gmatch.save.v1:${id.orbitId}`, JSON.stringify(save))
      localStorage.setItem('gmatch.save.v1', JSON.stringify(save))
      // lastSeenAt must be load-time or the offline-earnings modal pops on
      // every journey (passive income accrues between seed and page load).
      save.lastSeenAt = Date.now()
      // Onboarding: mark every step complete so the flow doesn't block.
      localStorage.setItem(
        `orbit_onboarding_v2:${id.orbitId}`,
        JSON.stringify({
          version: 1,
          current: 'ready',
          completed: ['welcome', 'auth', 'profile', 'platform', 'feed', 'tune', 'cards', 'economy', 'games', 'ready'],
        }),
      )
    },
    [identity, idleSave, legalVersionKey()],
  )
  return identity
}
