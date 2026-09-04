// ScoreService — explicit separation of the two non-currency score concepts.
//
//   - daily score (`Users.score`)      — today's activity/leaderboard haul,
//     reset once per UTC day by maintenance.
//   - reputation (`Users.score_total`) — persistent, never reset by daily
//     maintenance.
//
// This is distinct from the g$ economy (`Wallets`/`EconomyService`), which is
// the only spendable currency. Rewards that award points should go through here
// (and g$ rewards through EconomyService) so no subsystem conflates the two.

import type { D1Turso } from './db'
import { requireId } from './common/validation'
import { badRequest } from './common/errors'

export class ScoreService {
  constructor(private db: D1Turso) {}

  async getDailyScore(userId: string): Promise<number> {
    requireId(userId, 'userId')
    const row = await this.db.prepare('SELECT COALESCE(score, 0) AS score FROM Users WHERE id = ?').bind(userId).first<{ score: number }>()
    return Number(row?.score ?? 0)
  }

  async getReputation(userId: string): Promise<number> {
    requireId(userId, 'userId')
    const row = await this.db.prepare('SELECT COALESCE(score_total, 0) AS score_total FROM Users WHERE id = ?').bind(userId).first<{ score_total: number }>()
    return Number(row?.score_total ?? 0)
  }

  // Award both today's score and lifetime reputation in one atomic update. This
  // is the default for game/social rewards: the daily board shows today's haul
  // and reputation keeps a permanent record.
  async award(userId: string, points: number): Promise<void> {
    requireId(userId, 'userId')
    const p = this.validatePoints(points)
    await this.db
      .prepare('UPDATE Users SET score = COALESCE(score, 0) + ?, score_total = COALESCE(score_total, 0) + ? WHERE id = ?')
      .bind(p, p, userId)
      .run()
  }

  async awardDaily(userId: string, points: number): Promise<void> {
    requireId(userId, 'userId')
    const p = this.validatePoints(points)
    await this.db.prepare('UPDATE Users SET score = COALESCE(score, 0) + ? WHERE id = ?').bind(p, userId).run()
  }

  async awardReputation(userId: string, points: number): Promise<void> {
    requireId(userId, 'userId')
    const p = this.validatePoints(points)
    await this.db.prepare('UPDATE Users SET score_total = COALESCE(score_total, 0) + ? WHERE id = ?').bind(p, userId).run()
  }

  private validatePoints(points: number): number {
    if (typeof points !== 'number' || !Number.isSafeInteger(points) || points <= 0) {
      throw badRequest('points must be a positive integer')
    }
    return points
  }
}
