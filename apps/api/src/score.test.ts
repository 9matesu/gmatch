import { describe, it, expect, beforeEach } from 'vitest'
import { createMockEnv } from './test-utils'
import { ScoreService } from './score'
import { EconomyService } from './economy'
import { maybeResetDailyScores } from './cleanup'
import type { D1Turso } from './db'

describe('ScoreService', () => {
  let db: D1Turso
  let score: ScoreService

  async function seedUser(id: string) {
    await db.prepare('INSERT OR IGNORE INTO Users (id, public_key) VALUES (?, ?)').bind(id, `pk-${id}`).run()
  }

  beforeEach(async () => {
    const env = await createMockEnv()
    db = env.DB
    score = new ScoreService(db)
    await seedUser('alice-user-01')
  })

  it('awards both daily score and reputation atomically', async () => {
    await score.award('alice-user-01', 100)
    await expect(score.getDailyScore('alice-user-01')).resolves.toBe(100)
    await expect(score.getReputation('alice-user-01')).resolves.toBe(100)
  })

  it('awards daily and reputation independently', async () => {
    await score.awardDaily('alice-user-01', 30)
    await score.awardReputation('alice-user-01', 70)
    await expect(score.getDailyScore('alice-user-01')).resolves.toBe(30)
    await expect(score.getReputation('alice-user-01')).resolves.toBe(70)
  })

  it('rejects non-positive or unsafe points', async () => {
    await expect(score.award('alice-user-01', 0)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(score.award('alice-user-01', -5)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(score.award('alice-user-01', 1.5)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(score.award('alice-user-01', Number.MAX_SAFE_INTEGER + 10)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('daily reset clears daily score but preserves reputation and wallet', async () => {
    const economy = new EconomyService(db)
    await score.award('alice-user-01', 100)
    await economy.credit('alice-user-01', 500, { idempotencyKey: 'score-test-seed', kind: 'grant' })

    await maybeResetDailyScores(db)

    await expect(score.getDailyScore('alice-user-01')).resolves.toBe(0)
    await expect(score.getReputation('alice-user-01')).resolves.toBe(100)
    await expect(economy.getBalance('alice-user-01')).resolves.toBe(500)
  })
})
