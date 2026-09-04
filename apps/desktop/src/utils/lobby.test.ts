import { describe, it, expect } from 'vitest'
import {
  currentMatch,
  activeTask,
  myCardId,
  opponentCardId,
  countdownMs,
  formatCountdown,
  formatElapsed,
  matchWindowMs,
  displayName,
} from './lobby'
import type { LobbyState, MatchSnapshot } from '@orbit/shared'

function snap(phase: MatchSnapshot['phase'], extra: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return Object.assign(
    {
      id: 'm1',
      phase,
      status: phase === 'result' ? 'ended' : 'playing',
      phase_deadline: Date.now() + 60_000,
      round_seq: 1,
      max_rounds: 5,
      score_mine: 0,
      score_opponent: 0,
      rounds_history: [],
      played_cards: [],
      my_card: null,
      my_decided: false,
      opponent: { id: 'them' },
      opponent_card: null,
      opponent_played: false,
      opponent_decided: false,
      matched: false,
      result: null,
    },
    extra
  )
}

function state(match: MatchSnapshot | null): LobbyState {
  return { status: 'waiting', waiting_count: 0, players: [], match }
}

describe('lobby helpers (1v1 match)', () => {
  it('currentMatch returns the live match, or null', () => {
    const m = snap('pick')
    expect(currentMatch(state(m))?.id).toBe('m1')
    expect(currentMatch(state(null))).toBeNull()
    expect(currentMatch(null)).toBeNull()
  })

  it('activeTask tracks phase and whether I have acted', () => {
    expect(activeTask(null)).toBeNull()
    expect(activeTask(snap('lobby'))).toBe('lobby')
    expect(activeTask(snap('pick'))).toBe('pick')
    // after I played but cards still face down (opponent hasn't)
    expect(activeTask(snap('pick', { my_card: 'c1' }))).toBe('reveal')
    expect(activeTask(snap('reveal'))).toBe('reveal')
    expect(activeTask(snap('decide'))).toBe('decide')
    expect(activeTask(snap('decide', { my_decided: true, opponent_decided: false }))).toBe('reveal')
    expect(activeTask(snap('decide', { my_decided: true, opponent_decided: true }))).toBe('round_result')
    expect(activeTask(snap('round_result'))).toBe('round_result')
    expect(activeTask(snap('result'))).toBe('result')
  })

  it('tracks my card and opponent card from the snapshot', () => {
    expect(myCardId(snap('pick', { my_card: 'mine' }))).toBe('mine')
    expect(myCardId(null)).toBeNull()
    expect(opponentCardId(snap('reveal', { opponent_card: 'theirs' }))).toBe('theirs')
    expect(opponentCardId(snap('pick'))).toBeNull()
  })

  it('counts down and formats', () => {
    const deadline = Date.now() + 45_000
    const ms = countdownMs(deadline, Date.now())
    expect(ms).toBeGreaterThan(44_000)
    expect(ms).toBeLessThanOrEqual(45_000)
    expect(countdownMs(0, Date.now())).toBe(0)
    expect(formatCountdown(45_000)).toBe('0:45')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(65_000)).toBe('1:05')
  })

  it('matchWindowMs differs by phase', () => {
    expect(matchWindowMs(snap('lobby'))).toBe(10_000)
    expect(matchWindowMs(snap('pick'))).toBe(60_000)
    expect(matchWindowMs(snap('reveal'))).toBe(4_000)
    expect(matchWindowMs(snap('decide'))).toBe(45_000)
    expect(matchWindowMs(snap('round_result'))).toBe(3_000)
    expect(matchWindowMs(null)).toBe(45_000)
  })

  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(125_000)).toBe('2:05')
    expect(formatElapsed(-100)).toBe('0:00')
  })

it('displayName falls back to generated name from orbitId', () => {
    const players = state(null).players.concat()
    players.push({ user_id: 'they', status: 'waiting', joined_at: new Date().toISOString(), display_name: 'Them' })
    expect(displayName('they', players)).toBe('Them')
    expect(displayName('1234567890', players)).toBe('User_123456')
  })
})
