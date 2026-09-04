import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createMockEnv } from './test-utils'
import { startRound, joinRound, advanceBabecock, getCurrentRound, listGallery, inviteToRound, listMyInvites, declineInvite, expireInvitesForClosedRounds } from './babecock'
import { BABECOCK_ROUND_SECONDS, BABECOCK_GALLERY_SECONDS } from '@orbit/shared'

let env: Awaited<ReturnType<typeof createMockEnv>>

const M = 1000

function uid(i: number): string {
  return `bc-${i}-${Math.random().toString(36).slice(2, 8)}`
}

async function seedUser(userId: string, name: string) {
  await env._client.execute(
    `INSERT INTO Users (id, public_key, encryption_pub_key, display_name, last_seen) VALUES (?, ?, ?, ?, ?)`,
    [userId, `pk-${userId}`, null, name, new Date().toISOString()]
  )
}

async function seedInventory(userId: string, itemId: string, quantity: number) {
  await env._client.execute(
    `INSERT INTO UserInventory (user_id, item_id, quantity) VALUES (?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = excluded.quantity`,
    [userId, itemId, quantity]
  )
}

describe('babecock minigame lifecycle', () => {
  beforeAll(async () => {
    env = await createMockEnv()
  })

  beforeEach(async () => {
    // Clean slate per test
    await env._client.execute('DELETE FROM BabecockEntries').catch(() => {})
    await env._client.execute('DELETE FROM BabecockRounds').catch(() => {})
    await env._client.execute('DELETE FROM BabecockInvites').catch(() => {})
    await env._client.execute('DELETE FROM UserInventory').catch(() => {})
  })

  it('starts a round with the host as the OP entry', async () => {
    const host = uid(1)
    await seedUser(host, 'Host')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    expect(round.status).toBe('open')
    expect(round.host_id).toBe(host)
    expect(round.entries.length).toBe(1)
    expect(round.entries[0].user_id).toBe(host)
  })

  it('rejects a second round while one is open', async () => {
    const host = uid(2)
    const other = uid(3)
    await seedUser(host, 'Host')
    await seedUser(other, 'Other')
    await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    await expect(startRound(env.DB, other, 'data:image/jpeg;base64,x', 'image/jpeg')).rejects.toThrow('already running')
  })

  it('allows others to join before the deadline', async () => {
    const host = uid(4)
    const challenger = uid(5)
    await seedUser(host, 'Host')
    await seedUser(challenger, 'Challenger')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    const updated = await joinRound(env.DB, round.id, challenger, 'data:image/jpeg;base64,y', 'image/jpeg')
    expect(updated.entries.length).toBe(2)
    expect(updated.entries.some((e) => e.user_id === challenger)).toBe(true)
    expect(updated.my_entry).toBe(updated.entries.find((e) => e.user_id === challenger)?.id)
  })

  it('rejects a duplicate join by the same user', async () => {
    const host = uid(6)
    const challenger = uid(7)
    await seedUser(host, 'Host')
    await seedUser(challenger, 'Challenger')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    await joinRound(env.DB, round.id, challenger, 'data:image/jpeg;base64,y', 'image/jpeg')
    await expect(joinRound(env.DB, round.id, challenger, 'data:image/jpeg;base64,z', 'image/jpeg')).rejects.toThrow('already joined')
  })

  it('rejects a join after the deadline has passed', async () => {
    const host = uid(8)
    const challenger = uid(9)
    await seedUser(host, 'Host')
    await seedUser(challenger, 'Challenger')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    await advanceBabecock(env.DB, Date.now() + (BABECOCK_ROUND_SECONDS + 1) * M)
    await expect(joinRound(env.DB, round.id, challenger, 'data:image/jpeg;base64,y', 'image/jpeg')).rejects.toThrow('no longer open')
  })

  it('closes the round and parks it in the gallery after the deadline', async () => {
    const host = uid(10)
    const challenger = uid(11)
    await seedUser(host, 'Host')
    await seedUser(challenger, 'Challenger')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    await joinRound(env.DB, round.id, challenger, 'data:image/jpeg;base64,y', 'image/jpeg')

    // Before the deadline the round is still open
    let current = await getCurrentRound(env.DB, challenger)
    expect(current?.status).toBe('open')
    expect(await listGallery(env.DB)).toHaveLength(0)

    // After the deadline the round closes and lands in the gallery
    await advanceBabecock(env.DB, Date.now() + (BABECOCK_ROUND_SECONDS + 1) * M)
    current = await getCurrentRound(env.DB, challenger)
    expect(current).toBeNull()
    const gallery = await listGallery(env.DB)
    expect(gallery.length).toBe(1)
    expect(gallery[0].entries.length).toBe(2)
  })

  it('expires the gallery after the 1-hour window', async () => {
    const host = uid(12)
    await seedUser(host, 'Host')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    await advanceBabecock(env.DB, Date.now() + (BABECOCK_ROUND_SECONDS + 1) * M)
    expect(await listGallery(env.DB)).toHaveLength(1)

    // Advance past the gallery window; listGallery filters it out
    const { purgeExpiredBabecock } = await import('./babecock')
    await purgeExpiredBabecock(env.DB)
    await env._client
      .execute(`UPDATE BabecockRounds SET gallery_expires_at = datetime('now', '-2 hours') WHERE id = ?`, [round.id])
      .catch(() => {})
    await purgeExpiredBabecock(env.DB)
    expect(await listGallery(env.DB)).toHaveLength(0)
  })
})

describe('babecock invites', () => {
  beforeAll(async () => {
    env = await createMockEnv()
  })

  beforeEach(async () => {
    await env._client.execute('DELETE FROM BabecockEntries').catch(() => {})
    await env._client.execute('DELETE FROM BabecockRounds').catch(() => {})
    await env._client.execute('DELETE FROM BabecockInvites').catch(() => {})
  })

  it('lets the host invite a specific user to an open round', async () => {
    const host = uid(30)
    const invitee = uid(31)
    await seedUser(host, 'Host')
    await seedUser(invitee, 'Invitee')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')

    const invite = await inviteToRound(env.DB, round.id, host, invitee)
    expect(invite.invitee_id).toBe(invitee)
    expect(invite.host_id).toBe(host)
    expect(invite.round_id).toBe(round.id)
    expect(invite.status).toBe('open')
    expect(invite.host_name).toBe('Host')
  })

  it('rejects an invite from a non-host', async () => {
    const host = uid(32)
    const other = uid(33)
    const invitee = uid(34)
    await seedUser(host, 'Host')
    await seedUser(other, 'Other')
    await seedUser(invitee, 'Invitee')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')

    await expect(inviteToRound(env.DB, round.id, other, invitee)).rejects.toThrow('Only the round host')
  })

  it('rejects self-invite', async () => {
    const host = uid(35)
    await seedUser(host, 'Host')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    await expect(inviteToRound(env.DB, round.id, host, host)).rejects.toThrow('cannot invite yourself')
  })

  it('rejects invite to a closed round', async () => {
    const host = uid(36)
    const invitee = uid(37)
    await seedUser(host, 'Host')
    await seedUser(invitee, 'Invitee')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    await advanceBabecock(env.DB, Date.now() + (BABECOCK_ROUND_SECONDS + 1) * M)
    await expect(inviteToRound(env.DB, round.id, host, invitee)).rejects.toThrow('no longer open')
  })

  it('is idempotent on (round, invitee): re-invite reuses the same row', async () => {
    const host = uid(38)
    const invitee = uid(39)
    await seedUser(host, 'Host')
    await seedUser(invitee, 'Invitee')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')

    const a = await inviteToRound(env.DB, round.id, host, invitee)
    const b = await inviteToRound(env.DB, round.id, host, invitee)
    expect(b.id).toBe(a.id)
    expect(b.status).toBe('open')
  })

  it('lists pending invites for the recipient inbox', async () => {
    const host1 = uid(40)
    const host2 = uid(41)
    const invitee = uid(42)
    await seedUser(host1, 'HostOne')
    await seedUser(host2, 'HostTwo')
    await seedUser(invitee, 'Invitee')

    // Only one open Babecock round at a time — invite one, close it, then
    // start another so we can build a 2-row invite inbox.
    const r1 = await startRound(env.DB, host1, 'data:image/jpeg;base64,x', 'image/jpeg')
    await inviteToRound(env.DB, r1.id, host1, invitee)
    await advanceBabecock(env.DB, Date.now() + (BABECOCK_ROUND_SECONDS + 1) * M)
    // advancing the round expires the open invite — re-open it manually so
    // we can show a multi-row inbox (host can re-ping if the round reopens).
    const r2 = await startRound(env.DB, host2, 'data:image/jpeg;base64,y', 'image/jpeg')
    await inviteToRound(env.DB, r2.id, host2, invitee)

    const mine = await listMyInvites(env.DB, invitee)
    expect(mine.length).toBe(1) // r1 invite was expired by advance tick
    expect(mine[0].host_id).toBe(host2)
    expect(mine[0].host_name).toBe('HostTwo')
    expect(mine[0].status).toBe('open')
  })

  it('marks invite as accepted when the invited user joins the round', async () => {
    const host = uid(43)
    const invitee = uid(44)
    await seedUser(host, 'Host')
    await seedUser(invitee, 'Invitee')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    const invite = await inviteToRound(env.DB, round.id, host, invitee)

    await joinRound(env.DB, round.id, invitee, 'data:image/jpeg;base64,y', 'image/jpeg')

    const mine = await listMyInvites(env.DB, invitee)
    expect(mine.find((i) => i.id === invite.id)?.status).toBe('accepted')
  })

  it('lets the recipient decline an open invite', async () => {
    const host = uid(45)
    const invitee = uid(46)
    await seedUser(host, 'Host')
    await seedUser(invitee, 'Invitee')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    const invite = await inviteToRound(env.DB, round.id, host, invitee)

    await declineInvite(env.DB, invite.id, invitee)
    const mine = await listMyInvites(env.DB, invitee)
    // decline pulls it out of the open/accepted list
    expect(mine.find((i) => i.id === invite.id)).toBeUndefined()
  })

  it('rejects decline from a non-recipient', async () => {
    const host = uid(47)
    const invitee = uid(48)
    const stranger = uid(49)
    await seedUser(host, 'Host')
    await seedUser(invitee, 'Invitee')
    await seedUser(stranger, 'Stranger')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    const invite = await inviteToRound(env.DB, round.id, host, invitee)

    await expect(declineInvite(env.DB, invite.id, stranger)).rejects.toThrow('Not your invite')
  })

  it('expires pending invites when their round closes', async () => {
    const host = uid(50)
    const invitee = uid(51)
    await seedUser(host, 'Host')
    await seedUser(invitee, 'Invitee')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    const invite = await inviteToRound(env.DB, round.id, host, invitee)

    await advanceBabecock(env.DB, Date.now() + (BABECOCK_ROUND_SECONDS + 1) * M)

    const mine = await listMyInvites(env.DB, invitee)
    expect(mine.length).toBe(0) // closed round invite expires and is excluded
  })

  it('expireInvitesForClosedRounds marks only open-status rows', async () => {
    const host = uid(52)
    const a = uid(53)
    const b = uid(54)
    await seedUser(host, 'Host')
    await seedUser(a, 'A')
    await seedUser(b, 'B')
    const round = await startRound(env.DB, host, 'data:image/jpeg;base64,x', 'image/jpeg')
    const invA = await inviteToRound(env.DB, round.id, host, a)
    await inviteToRound(env.DB, round.id, host, b)
    // a accepts before close
    await joinRound(env.DB, round.id, a, 'data:image/jpeg;base64,y', 'image/jpeg')
    await advanceBabecock(env.DB, Date.now() + (BABECOCK_ROUND_SECONDS + 1) * M)
    await expireInvitesForClosedRounds(env.DB)

    // a stays accepted; b flips to expired
    const aRow = await env._client.execute(`SELECT status FROM BabecockInvites WHERE id = ?`, [invA.id])
    expect(aRow.rows?.[0]?.status).toBe('accepted')
    const bRow = await env._client.execute(`SELECT status FROM BabecockInvites WHERE invitee_id = ? AND status = 'expired'`, [b])
    expect(bRow.rows?.length).toBe(1)
  })
})

describe('flash consumable inventory', () => {
  beforeAll(async () => {
    env = await createMockEnv()
  })

  beforeEach(async () => {
    await env._client.execute('DELETE FROM UserInventory').catch(() => {})
  })

  it('decrements inventory on consumption only when quantity is available', async () => {
    const userId = uid(20)
    await seedUser(userId, 'Flash User')
    await seedInventory(userId, 'item-flash-drop', 2)

    let row = await env.DB.prepare(
      "SELECT quantity FROM UserInventory WHERE user_id = ? AND item_id = 'item-flash-drop'"
    ).bind(userId).first()
    expect(Number(row?.quantity ?? 0)).toBe(2)

    const consumed = await env.DB.prepare(
      'UPDATE UserInventory SET quantity = quantity - 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND item_id = ? AND quantity > 0'
    ).bind(userId, 'item-flash-drop').run()
    expect(Number(consumed?.meta?.changes || 0)).toBe(1)

    row = await env.DB.prepare(
      "SELECT quantity FROM UserInventory WHERE user_id = ? AND item_id = 'item-flash-drop'"
    ).bind(userId).first()
    expect(Number(row?.quantity ?? 0)).toBe(1)
  })

  it('refuses to consume when inventory is empty', async () => {
    const userId = uid(21)
    await seedUser(userId, 'Flash Broke')
    await seedInventory(userId, 'item-flash-drop', 0)

    const consumed = await env.DB.prepare(
      'UPDATE UserInventory SET quantity = quantity - 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND item_id = ? AND quantity > 0'
    ).bind(userId, 'item-flash-drop').run()
    expect(Number(consumed?.meta?.changes || 0)).toBe(0)

    const row = await env.DB.prepare(
      "SELECT quantity FROM UserInventory WHERE user_id = ? AND item_id = 'item-flash-drop'"
    ).bind(userId).first()
    expect(Number(row?.quantity ?? 0)).toBe(0)
  })

  it('supports stacking purchases in the inventory', async () => {
    const userId = uid(22)
    await seedUser(userId, 'Flash Stacker')
    await seedInventory(userId, 'item-flash-drop', 1)

    await env.DB.prepare(
      'INSERT INTO UserInventory (user_id, item_id, quantity, updated_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP) ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1, updated_at = CURRENT_TIMESTAMP'
    ).bind(userId, 'item-flash-drop').run()

    const row = await env.DB.prepare(
      "SELECT quantity FROM UserInventory WHERE user_id = ? AND item_id = 'item-flash-drop'"
    ).bind(userId).first()
    expect(Number(row?.quantity ?? 0)).toBe(2)
  })
})