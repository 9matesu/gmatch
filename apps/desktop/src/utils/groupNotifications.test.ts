import { describe, expect, it } from 'vitest'
import { groupNotifications, groupTitle, type NotifItem } from './groupNotifications'

const row = (id: string, type: string, data: object, minutesAgo = 0, read = 0): NotifItem => ({
  id, type, title: 'x', body: null, data, read,
  created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
})

describe('groupNotifications', () => {
  it('collapses likes on the same card within 24h', () => {
    const rows = [row('1', 'like', { card_id: 'c', actor: 'bob' }), row('2', 'like', { card_id: 'c', actor: 'amy' })]
    const g = groupNotifications(rows)
    expect(g.length).toBe(1)
    expect(g[0].items.map((i) => i.id).sort()).toEqual(['1', '2'])
  })
  it('keeps different subjects separate', () => {
    const g = groupNotifications([row('1', 'like', { card_id: 'c1', actor: 'a' }), row('2', 'like', { card_id: 'c2', actor: 'a' })])
    expect(g.length).toBe(2)
  })
  it('pm/system rows never group', () => {
    const g = groupNotifications([row('1', 'pm', {}), row('2', 'system', {})])
    expect(g.length).toBe(2)
  })
})

describe('groupTitle', () => {
  it('single actor keeps the plain sentence', () => {
    expect(groupTitle('like', ['Rafael'])).toBe('Rafael liked your card')
  })
  it('many actors fold to "X and N others"', () => {
    expect(groupTitle('like', ['Rafael', 'a', 'b', 'c'])).toBe('Rafael and 3 others liked your card')
  })
  it('follow folds to "X and N others started following you"', () => {
    expect(groupTitle('follow', ['A', 'B'])).toBe('A and 1 other started following you')
  })
})
