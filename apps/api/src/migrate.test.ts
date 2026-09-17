import { describe, it, expect } from 'vitest'
import { createClient } from '@libsql/client'
import { migrate } from './migrate'

// Verifies the gMatch Phase 1 migrations (014-017) bring an existing
// pre-gMatch database up to the current canonical schema, and that the
// migration runner is idempotent on fresh AND previously-migrated DBs.

async function columnExists(client: Awaited<ReturnType<typeof createClient>>, table: string, column: string): Promise<boolean> {
  const res = await client.execute(`PRAGMA table_info(${table})`)
  return (res.rows || []).some((r: any) => r.name === column)
}

async function tableExists(client: Awaited<ReturnType<typeof createClient>>, table: string): Promise<boolean> {
  const res = await client.execute(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, [table])
  return (res.rows || []).length > 0
}

async function indexExists(client: Awaited<ReturnType<typeof createClient>>, name: string): Promise<boolean> {
  const res = await client.execute(`SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`, [name])
  return (res.rows || []).length > 0
}

async function userVersion(client: Awaited<ReturnType<typeof createClient>>): Promise<number> {
  const { rows } = await client.execute('PRAGMA user_version')
  return Number(rows?.[0]?.user_version ?? 0)
}

describe('gMatch Phase 1 migrations', () => {
  it('migrates a fresh in-memory DB to user_version 54 with all new tables/columns', async () => {
    const client = createClient({ url: ':memory:' })
    await migrate(client)

    expect(await userVersion(client)).toBe(54)

    // Followers table (migration 014)
    expect(await tableExists(client, 'Followers')).toBe(true)
    expect(await indexExists(client, 'idx_followers_followee')).toBe(true)
    expect(await tableExists(client, 'HackDebuffs')).toBe(true)
    expect(await indexExists(client, 'idx_hack_debuffs_target')).toBe(true)
    expect(await indexExists(client, 'idx_followers_follower')).toBe(true)

    // Posts columns on Objects (migration 015 & 053)
    for (const col of ['is_public', 'post_caption', 'location', 'shared_from', 'like_count', 'comment_count', 'share_count', 'is_avatar']) {
      expect(await columnExists(client, 'Objects', col)).toBe(true)
    }
    expect(await indexExists(client, 'idx_objects_public_feed')).toBe(true)
    expect(await indexExists(client, 'idx_objects_trending')).toBe(true)
    expect(await indexExists(client, 'idx_objects_shared_from')).toBe(true)
    expect(await indexExists(client, 'idx_objects_is_avatar')).toBe(true)

    // Post engagement tables (migration 016)
    expect(await tableExists(client, 'Comments')).toBe(true)
    expect(await tableExists(client, 'CommentLikes')).toBe(true)
    expect(await tableExists(client, 'Saves')).toBe(true)
    expect(await indexExists(client, 'idx_comments_object')).toBe(true)
    expect(await indexExists(client, 'idx_comment_likes_comment')).toBe(true)
    expect(await indexExists(client, 'idx_saves_user')).toBe(true)

    // Profile extras (migration 017)
    for (const col of ['is_private', 'bio', 'website', 'followers_count', 'following_count', 'posts_count']) {
      expect(await columnExists(client, 'Users', col)).toBe(true)
    }
    expect(await indexExists(client, 'idx_users_is_private')).toBe(true)
    expect(await indexExists(client, 'idx_users_followers_count')).toBe(true)

    // Post likes + post_tags (migration 018)
    expect(await tableExists(client, 'PostLikes')).toBe(true)
    expect(await indexExists(client, 'idx_post_likes_object')).toBe(true)
    expect(await indexExists(client, 'idx_post_likes_user')).toBe(true)
    expect(await columnExists(client, 'Objects', 'post_tags')).toBe(true)

    // Moderators and sensitive flags (migration 019)
    expect(await columnExists(client, 'Users', 'is_moderator')).toBe(true)
    expect(await columnExists(client, 'Objects', 'is_sensitive')).toBe(true)
    expect(await columnExists(client, 'Objects', 'sensitive_reason')).toBe(true)
    expect(await indexExists(client, 'idx_users_is_moderator')).toBe(true)
    expect(await indexExists(client, 'idx_objects_is_sensitive')).toBe(true)

    // Slideshows (migration 025)
    expect(await tableExists(client, 'Slideshows')).toBe(true)
    expect(await tableExists(client, 'SlideshowItems')).toBe(true)
    expect(await indexExists(client, 'idx_slideshows_owner')).toBe(true)
    expect(await indexExists(client, 'idx_slideshow_items_slide')).toBe(true)

    // Lootboxes (migration 026)
    expect(await tableExists(client, 'Lootboxes')).toBe(true)
    expect(await indexExists(client, 'idx_lootboxes_released')).toBe(true)

    // Chat groups + DM replies (migration 027)
    expect(await tableExists(client, 'ChatGroups')).toBe(true)
    expect(await tableExists(client, 'ChatGroupMembers')).toBe(true)
    expect(await tableExists(client, 'GroupMessages')).toBe(true)
    expect(await columnExists(client, 'PrivateMessages', 'reply_to')).toBe(true)

    // PM read receipts (migration 028)
    expect(await tableExists(client, 'PmReadReceipts')).toBe(true)

    // Multi-image posts (migration 029)
    expect(await columnExists(client, 'Objects', 'post_group')).toBe(true)
    expect(await indexExists(client, 'idx_objects_post_group')).toBe(true)

    // PM attachments (migration 030)
    expect(await columnExists(client, 'PrivateMessages', 'attachment_id')).toBe(true)
    expect(await indexExists(client, 'idx_pm_attachment')).toBe(true)

    // Cards permanent (migration 031) — no schema change, just a backfill

    // Group message attachments (migration 032)
    expect(await columnExists(client, 'GroupMessages', 'attachment_id')).toBe(true)
    expect(await indexExists(client, 'idx_group_messages_attachment')).toBe(true)

    // Lootbox configuration v2 (migration 033)
    for (const col of ['state', 'tags', 'draw_config', 'version', 'released_at', 'archived_at', 'created_by', 'updated_by']) {
      expect(await columnExists(client, 'Lootboxes', col)).toBe(true)
    }
    expect(await indexExists(client, 'idx_lootboxes_state')).toBe(true)

    // Card rarity normalization (migration 034)

    // Card creator metadata (migration 037)
    for (const col of ['tags', 'description', 'frame', 'accent_color']) {
      expect(await columnExists(client, 'Cards', col)).toBe(true)
    }

    // Persistent bot profiles (migration 038)
    expect(await tableExists(client, 'Bots')).toBe(true)
    expect(await indexExists(client, 'idx_bots_enabled')).toBe(true)

    // PC Domination (migration 039)
    expect(await columnExists(client, 'Users', 'pc_domination_enabled')).toBe(true)
    expect(await columnExists(client, 'Users', 'pc_domination_settings')).toBe(true)
    expect(await indexExists(client, 'idx_users_pc_domination')).toBe(true)
    expect(await tableExists(client, 'DominationActions')).toBe(true)
    expect(await indexExists(client, 'idx_domination_actions_victim')).toBe(true)
    expect(await indexExists(client, 'idx_domination_actions_dominator')).toBe(true)
    expect(await indexExists(client, 'idx_domination_actions_status')).toBe(true)
  })

  it('backfills legacy valuation and cards for eligible non-public objects', async () => {
    const client = createClient({ url: ':memory:' })
    await migrate(client)

    await client.execute("INSERT INTO Users (id, public_key, display_name) VALUES ('legacy-owner', 'legacy-owner-key', 'Legacy Owner')")
    await client.execute("INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, caption, is_public, is_story) VALUES ('legacy-object', 'legacy-owner', 1024, 'image/jpeg', 'https://example.test/legacy.jpg', 'Legacy Card', 0, 0)")
    await client.execute("INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, caption, is_public, is_story) VALUES ('legacy-post', 'legacy-owner', 1024, 'image/jpeg', 'https://example.test/post.jpg', 'Legacy Post', 1, 0)")
    await client.execute("INSERT INTO Likes (id, user_id, object_id, decision) VALUES ('legacy-like', 'legacy-voter-1', 'legacy-object', 'like')")
    await client.execute("INSERT INTO Likes (id, user_id, object_id, decision) VALUES ('legacy-boost', 'legacy-voter-2', 'legacy-object', 'boost')")
    await client.execute("INSERT INTO Likes (id, user_id, object_id, decision) VALUES ('legacy-reject', 'legacy-voter-3', 'legacy-object', 'reject')")

    // Rewind only the migration marker so 035 runs against the seeded legacy data.
    await client.execute('PRAGMA user_version = 34')
    await migrate(client)

    const object = await client.execute("SELECT gacha_downloads_count FROM Objects WHERE id = 'legacy-object'")
    expect(Number(object.rows[0]?.gacha_downloads_count)).toBe(30)

    const card = await client.execute("SELECT id, value, like_count FROM Cards WHERE media_object_id = 'legacy-object'")
    expect(card.rows).toHaveLength(1)
    expect(Number(card.rows[0]?.value)).toBe(30)
    expect(Number(card.rows[0]?.like_count)).toBe(1)

    const ownership = await client.execute("SELECT COUNT(*) AS count FROM CardOwnership WHERE card_id = ?", [card.rows[0]?.id])
    expect(Number(ownership.rows[0]?.count)).toBe(1)

    const history = await client.execute("SELECT COUNT(*) AS count FROM CardHistory WHERE card_id = ? AND event = 'backfilled'", [card.rows[0]?.id])
    expect(Number(history.rows[0]?.count)).toBe(1)

    const publicCard = await client.execute("SELECT COUNT(*) AS count FROM Cards WHERE media_object_id = 'legacy-post'")
    expect(Number(publicCard.rows[0]?.count)).toBe(0)

    // Reapplying 035 does not duplicate cards, ownership, or history.
    await client.execute('PRAGMA user_version = 34')
    await migrate(client)
    const cardCount = await client.execute("SELECT COUNT(*) AS count FROM Cards WHERE media_object_id = 'legacy-object'")
    const historyCount = await client.execute("SELECT COUNT(*) AS count FROM CardHistory WHERE card_id = ? AND event = 'backfilled'", [card.rows[0]?.id])
    expect(Number(cardCount.rows[0]?.count)).toBe(1)
    expect(Number(historyCount.rows[0]?.count)).toBe(1)
  })

  it('backfills legacy players into the economy (040): XP, wallets, and card valuation', async () => {
    const client = createClient({ url: ':memory:' })
    await migrate(client)

    // Legacy player: activity counters but no reputation, no wallet row.
    await client.execute(`
      INSERT INTO Users (id, public_key, display_name, objects_sent_count, likes_received, matches_total)
      VALUES ('legacy-player', 'legacy-player-key', 'Legacy Player', 2, 3, 1)
    `)

    // Legacy card whose canonical value lags its object's reputation score.
    await client.execute("INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_story, gacha_downloads_count) VALUES ('legacy-media', 'legacy-player', 1024, 'image/jpeg', 'https://example.test/card.jpg', 0, 0, 500)")
    await client.execute("INSERT INTO Cards (id, creator_id, media_object_id, name, rarity, value, market_status, moderation_state) VALUES ('legacy-card', 'legacy-player', 'legacy-media', 'Old Card', 'common', 0, 'none', 'active')")

    // Only migration 040 should run: bump user_version so 039+ are pending.
    // wallet_seed_v1 is already set by the first migrate(), so the one-time
    // seed in migrate.ts stays skipped and 040 alone must do the backfill.
    await client.execute('PRAGMA user_version = 39')
    await migrate(client)

    // Persistent XP backfilled from the legacy activity formula
    // (2*10 + 3*25 + 1*100 = 195).
    const user = await client.execute("SELECT score_total FROM Users WHERE id = 'legacy-player'")
    expect(Number(user.rows[0]?.score_total)).toBe(195)

    // Wallet created for the player, seeded from legacy XP.
    const wallet = await client.execute("SELECT balance FROM Wallets WHERE user_id = 'legacy-player'")
    expect(Number(wallet.rows[0]?.balance)).toBe(195)

    // Stale card valuation synced to the object's reputation score.
    const card = await client.execute("SELECT value FROM Cards WHERE id = 'legacy-card'")
    expect(Number(card.rows[0]?.value)).toBe(500)

    // Re-applying 040 is a no-op: nothing is clobbered.
    await client.execute('PRAGMA user_version = 39')
    await migrate(client)
    const wallet2 = await client.execute("SELECT balance FROM Wallets WHERE user_id = 'legacy-player'")
    expect(Number(wallet2.rows[0]?.balance)).toBe(195)
    const user2 = await client.execute("SELECT score_total FROM Users WHERE id = 'legacy-player'")
    expect(Number(user2.rows[0]?.score_total)).toBe(195)
    const card2 = await client.execute("SELECT value FROM Cards WHERE id = 'legacy-card'")
    expect(Number(card2.rows[0]?.value)).toBe(500)
  })

  it('is idempotent: migrating the same client twice yields the same schema and bumps no further version', async () => {
    const client = createClient({ url: ':memory:' })
    await migrate(client)
    const versionAfterFirst = await userVersion(client)
    expect(versionAfterFirst).toBe(54)
    expect(await columnExists(client, 'ServerDirectory', 'tags')).toBe(true)

    // Running migrate() again is a no-op
    await migrate(client)
    expect(await userVersion(client)).toBe(versionAfterFirst)
    expect(await tableExists(client, 'Followers')).toBe(true)
    expect(await columnExists(client, 'Objects', 'is_public')).toBe(true)
    expect(await tableExists(client, 'PostLikes')).toBe(true)
    expect(await columnExists(client, 'Users', 'is_moderator')).toBe(true)
  })

  it('upgrades a pre-gMatch snapshot (user_version 13) by applying 014-054', async () => {
    const client = createClient({ url: ':memory:' })
    await migrate(client)
    expect(await userVersion(client)).toBe(54)

    // Tear down gMatch additions so we're effectively at pre-014 state.
    await client.execute('DROP TABLE IF EXISTS Saves')
    await client.execute('DROP TABLE IF EXISTS CommentLikes')
    await client.execute('DROP TABLE IF EXISTS Comments')
    await client.execute('DROP TABLE IF EXISTS Followers')
    await client.execute('DROP TABLE IF EXISTS PostLikes')
    for (const idx of [
      'idx_comments_object', 'idx_comments_parent', 'idx_comments_author',
      'idx_comment_likes_comment', 'idx_saves_user',
      'idx_followers_followee', 'idx_followers_follower',
      'idx_objects_public_feed', 'idx_objects_trending',
      'idx_objects_shared_from', 'idx_users_is_private',
      'idx_users_followers_count',
      'idx_post_likes_object', 'idx_post_likes_user',
      'idx_users_is_moderator', 'idx_objects_is_sensitive',
    ]) {
      await client.execute(`DROP INDEX IF EXISTS ${idx}`)
    }
    // Pretend we're still on the pre-gMatch migration version.
    await client.execute('PRAGMA user_version = 13')

    // Re-run migrate — it should detect user_version=13 and apply 014-054 in order
    await migrate(client)

    expect(await userVersion(client)).toBe(54)
    expect(await tableExists(client, 'Followers')).toBe(true)
    expect(await tableExists(client, 'Comments')).toBe(true)
    expect(await tableExists(client, 'CommentLikes')).toBe(true)
    expect(await tableExists(client, 'Saves')).toBe(true)
    expect(await tableExists(client, 'PostLikes')).toBe(true)
    expect(await indexExists(client, 'idx_followers_followee')).toBe(true)
    expect(await indexExists(client, 'idx_comments_object')).toBe(true)
    expect(await indexExists(client, 'idx_saves_user')).toBe(true)
    expect(await indexExists(client, 'idx_post_likes_object')).toBe(true)
    expect(await columnExists(client, 'Users', 'is_moderator')).toBe(true)
  })
})

