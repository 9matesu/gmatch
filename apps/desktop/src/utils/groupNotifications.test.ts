import { describe, expect, it } from 'vitest'
import { groupNotifications, groupTitle, groupItemIds, groupTarget, type NotifItem } from './groupNotifications'

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
  // Copy follows the surface the action happened on: likes/comments land on
  // feed posts (routes/posts.ts), so "your card" was wrong under a photo.
  it('single actor keeps the plain sentence', () => {
    expect(groupTitle('like', ['Rafael'])).toBe('Rafael liked your post')
  })
  it('many actors fold to "X and N others"', () => {
    expect(groupTitle('like', ['Rafael', 'a', 'b', 'c'])).toBe('Rafael and 3 others liked your post')
  })
  it('follow folds to "X and N others started following you"', () => {
    expect(groupTitle('follow', ['A', 'B'])).toBe('A and 1 other started following you')
  })
  it('card purchase keeps card wording', () => {
    expect(groupTitle('card_purchase', ['Ana'])).toBe('Ana bought your card')
  })
})

describe('groupTarget / groupItemIds', () => {
  it('exposes the ids a group folds and the post it points at', () => {
    const rows = [
      row('n1', 'like', { post_id: 'p1', actor_id: 'u1', actor_name: 'Ana' }),
      row('n2', 'like', { post_id: 'p1', actor_id: 'u2', actor_name: 'Bo' }),
    ]
    const [g] = groupNotifications(rows)
    expect(groupItemIds(g).sort()).toEqual(['n1', 'n2'])
    expect(groupTarget(g)).toEqual({ postId: 'p1', userId: 'u2' })
  })
  it('a follow has no post, only the follower', () => {
    const [g] = groupNotifications([row('n1', 'follow', { follower_id: 'u9' })])
    expect(groupTarget(g)).toEqual({ postId: undefined, userId: 'u9' })
  })
})

describe('actor names', () => {
  it('prefers the server-written actor_name over the title token', () => {
    // "Sweet Pea liked your post" — the first token would be "Sweet".
    const [g] = groupNotifications([
      { ...row('n1', 'like', { post_id: 'p', actor_id: 'u', actor_name: 'Sweet Pea' }), title: 'Sweet Pea liked your post' },
    ])
    expect(g.actors).toEqual(['Sweet Pea'])
  })
  it('falls back to the id, then the title token', () => {
    const [byId] = groupNotifications([{ ...row('n1', 'like', { actor_id: 'u7' }), title: 'Zed liked your post' }])
    expect(byId.actors).toEqual(['u7'])
    const [byTitle] = groupNotifications([{ ...row('n2', 'like', {}), title: 'Zed liked your post' }])
    expect(byTitle.actors).toEqual(['Zed'])
  })
})
