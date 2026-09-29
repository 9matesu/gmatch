import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import type { TestIdentity } from '../test-utils'

/**
 * Admin E2E purge.
 *
 * The E2E suite is meant to be hermetic, but runs against a shared node before
 * that was enforced left hundreds of spec accounts in the directory and in chat
 * history. generateIdentity() mints a random keypair with no id prefix, so the
 * 'e2e' profile tag is the only handle on them — which makes these tests
 * doubly important: they are what proves the purge finds exactly those and
 * nothing else.
 */

let env: Awaited<ReturnType<typeof createMockEnv>>
let admin: TestIdentity

function auth(identity: TestIdentity, method: string, url: string, body?: string) {
  return { 'Content-Type': 'application/json', ...signRequestHeaders(identity, method, url, body) }
}

async function register(identity: TestIdentity) {
  await app.request('/api/users', { headers: signRequestHeaders(identity, 'GET', '/api/users') }, env)
}

async function grantAdmin(identity: TestIdentity) {
  await app.request('/api/admin/verify-pin', {
    method: 'POST',
    headers: auth(identity, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
    body: JSON.stringify({ pin: 'test-pin' }),
  }, { ...env, ADMIN_PIN: 'test-pin' })
}

async function purge(body: unknown) {
  const raw = JSON.stringify(body)
  const res = await app.request('/api/admin/purge-e2e', {
    method: 'POST',
    headers: auth(admin, 'POST', '/api/admin/purge-e2e', raw),
    body: raw,
  }, env)
  return { res, body: await res.json() as Record<string, unknown> }
}

/** Create a user with the given profile tags (as a JSON string, as stored). */
async function makeUser(id: string, displayName: string, tags: string | null) {
  await env.DB.prepare('INSERT INTO Users (id, public_key, display_name, tags) VALUES (?, ?, ?, ?)')
    .bind(id, `key-${id}`, displayName, tags)
    .run()
  return id
}

const E2E_TAGS = JSON.stringify(['e2e'])

describe('admin purge-e2e', () => {
  beforeAll(async () => {
    env = await createMockEnv()
    admin = createTestIdentity()
    await register(admin)
    await grantAdmin(admin)
  })

  it('uses the same tag the E2E suite seeds', () => {
    // The tag is duplicated between this route and e2e/helpers.ts. If either
    // side is renamed the purge silently stops finding anything, which looks
    // exactly like "there is nothing to purge". Pin them together.
    const helpers = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'desktop', 'e2e', 'helpers.ts'),
      'utf8',
    )
    const match = /export const E2E_TAG\s*=\s*'([^']+)'/.exec(helpers)
    expect(match, 'e2e/helpers.ts must still export E2E_TAG').toBeTruthy()
    expect(match![1]).toBe('e2e')
  })

  it('is a dry run unless explicitly told otherwise', async () => {
    await makeUser('dry-e2e', 'E2E Tester', E2E_TAGS)
    const { res, body } = await purge({})
    expect(res.status).toBe(200)
    expect(body.dryRun).toBe(true)
    expect(body.matched).toBeGreaterThanOrEqual(1)
    // Nothing was removed.
    const still = await env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind('dry-e2e').first()
    expect(still).toBeTruthy()
  })

  it('deletes only accounts carrying the e2e tag, and all their content', async () => {
    await makeUser('e2e-victim', 'E2E Tester', E2E_TAGS)
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_chat) VALUES ('e2e-obj', 'e2e-victim', 10, 'image/jpeg', 1)",
    ).run()
    await env.DB.prepare(
      "INSERT INTO LobbyChat (id, sender_id, sender_name, body, created_at, channel) VALUES ('e2e-msg', 'e2e-victim', 'E2E Tester', 'ping', '2026-01-01T00:00:00Z', 'global_lobby')",
    ).run()
    // A real user that must survive, and a near-miss tag that must not match.
    await makeUser('real-user', 'Alice', JSON.stringify(['artist']))
    await makeUser('near-miss', 'Not E2E', JSON.stringify(['e2e-extra']))
    await makeUser('no-tags', 'Anon', null)

    const { res, body } = await purge({ dryRun: false })
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.deleted).toBeGreaterThanOrEqual(1)

    // Gone: the account and everything it owned.
    expect(await env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind('e2e-victim').first()).toBeNull()
    expect(await env.DB.prepare('SELECT id FROM Objects WHERE id = ?').bind('e2e-obj').first()).toBeNull()
    expect(await env.DB.prepare('SELECT id FROM LobbyChat WHERE id = ?').bind('e2e-msg').first()).toBeNull()

    // Kept: real accounts, and a tag that merely contains "e2e".
    expect(await env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind('real-user').first()).toBeTruthy()
    expect(await env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind('near-miss').first()).toBeTruthy()
    expect(await env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind('no-tags').first()).toBeTruthy()
    // The admin account is not itself a victim.
    expect(await env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind(admin.orbitId).first()).toBeTruthy()
  })

  it('skips rows whose tags are not valid JSON instead of failing the whole purge', async () => {
    // users.ts stores whatever it got when JSON.parse throws, so this state is
    // reachable in production — and one such row must not make the purge 500.
    await makeUser('bad-json', 'Broken', 'not json at all "e2e" inline')
    await makeUser('good-e2e', 'E2E Tester', E2E_TAGS)

    const { res, body } = await purge({ dryRun: false })
    expect(res.status).toBe(200)
    // The bad row is left alone; the good one is still purged.
    expect(await env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind('bad-json').first()).toBeTruthy()
    expect(await env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind('good-e2e').first()).toBeNull()
    expect(body.deleted).toBe(1)
  })

  it('refuses to delete an admin account matched by the tag', async () => {
    // The E2E run pins its own admin PIN (playwright.config.ts), so an admin
    // account can legitimately carry the tag.
    await env.DB.prepare("UPDATE Users SET tags = ? WHERE id = ?").bind(E2E_TAGS, admin.orbitId).run()
    const { res, body } = await purge({ dryRun: false })
    expect(res.status).toBe(400)
    expect(String(body.error)).toMatch(/admin/i)
    expect(await env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind(admin.orbitId).first()).toBeTruthy()
    await env.DB.prepare('UPDATE Users SET tags = NULL WHERE id = ?').bind(admin.orbitId).run()
  })

  it('honours a limit so a large backlog can be drained in batches', async () => {
    for (let i = 0; i < 5; i++) await makeUser(`batch-${i}`, `E2E ${i}`, E2E_TAGS)

    // A limited dry run still reports the FULL backlog plus what one batch
    // would take — that is what tells an operator how many batches to run.
    const dry = await purge({ dryRun: true, limit: 2 })
    expect(Number(dry.body.matched)).toBe(5)
    expect(dry.body.wouldDelete).toBe(2)
    expect(dry.body.limited).toBe(true)

    const cut = await purge({ dryRun: false, limit: 2 })
    expect(cut.body.deleted).toBe(2)

    const rest = await env.DB.prepare("SELECT COUNT(*) AS n FROM Users WHERE id LIKE 'batch-%'").first<{ n: number }>()
    expect(Number(rest?.n)).toBe(3)

    // Drain the rest so the shared fixture is clean for the next test.
    await purge({ dryRun: false })
  })

  it('reports zero when there is nothing to purge', async () => {
    const { res, body } = await purge({ dryRun: false })
    expect(res.status).toBe(200)
    expect(body.deleted).toBe(0)
  })
})
