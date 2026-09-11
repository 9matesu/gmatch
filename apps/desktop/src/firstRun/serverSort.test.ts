import { describe, expect, it } from 'vitest'
import { sortDirectoryServers } from './serverSort'
import type { DirectoryServer } from '../components/servers/ServersView'

const s = (over: Partial<DirectoryServer> & { name: string }): DirectoryServer => ({
  id: over.name, owner_id: 'o', password_required: 0, ...over,
})

describe('sortDirectoryServers', () => {
  it('pins the central row first under both sorts', () => {
    const rows = [
      s({ name: 'ZZZ', endpoint_hint: 'https://a.example', online_count: 99 }),
      s({ name: 'Central', endpoint_hint: 'https://gmatch.fly.dev' }),
      s({ name: 'AAA', endpoint_hint: 'https://b.example', online_count: 1 }),
    ]
    expect(sortDirectoryServers(rows, 'https://gmatch.fly.dev', 'name').map((r) => r.name))
      .toEqual(['Central', 'AAA', 'ZZZ'])
    expect(sortDirectoryServers(rows, 'https://gmatch.fly.dev', 'players').map((r) => r.name))
      .toEqual(['Central', 'ZZZ', 'AAA'])
  })

  it('sorts by players desc with user_count tie-break; unknown counts last', () => {
    const rows = [
      s({ name: 'b', endpoint_hint: 'h1:1', online_count: 5, user_count: 10 }),
      s({ name: 'a', endpoint_hint: 'h2:2', online_count: 5, user_count: 99 }),
      s({ name: 'c', endpoint_hint: 'h3:3' }),
    ]
    expect(sortDirectoryServers(rows, 'https://central.example', 'players').map((r) => r.name))
      .toEqual(['a', 'b', 'c'])
  })

  it('never pins rows without endpoint_hint and returns empty for empty', () => {
    expect(sortDirectoryServers([], 'https://central.example', 'players')).toEqual([])
    const noHint = s({ name: 'ghost', online_count: 500 })
    const out = sortDirectoryServers([noHint, s({ name: 'cen', endpoint_hint: 'https://central.example' })], 'https://central.example', 'players')
    expect(out.map((r) => r.name)).toEqual(['cen', 'ghost'])
  })

  it('tolerates an invalid central url (falls back to plain sort)', () => {
    const rows = [s({ name: 'b' }), s({ name: 'a' })]
    expect(sortDirectoryServers(rows, 'not a url', 'name').map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('matches host for host:port hints (central reachable via bare address)', () => {
    const rows = [
      s({ name: 'other', endpoint_hint: 'https://b.example', online_count: 50 }),
      s({ name: 'cen', endpoint_hint: 'gmatch.fly.dev:443' }),
    ]
    expect(sortDirectoryServers(rows, 'https://gmatch.fly.dev', 'players').map((r) => r.name))
      .toEqual(['cen', 'other'])
  })
})
