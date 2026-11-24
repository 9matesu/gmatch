import { describe, expect, it } from 'vitest'
import { deleteOutcomeForStatus } from './deleteOutcome'

describe('deleteOutcomeForStatus', () => {
  it('404 = already gone: the goal state holds', () => {
    expect(deleteOutcomeForStatus(404)).toBe('deleted')
  })

  it('2xx = the node confirmed the delete', () => {
    expect(deleteOutcomeForStatus(200)).toBe('deleted')
    expect(deleteOutcomeForStatus(204)).toBe('deleted')
  })

  it('timeout / offline / busy = local tombstone (invalid local post can be removed)', () => {
    // orbitFetch returns 503 on network failure, and these are the retryable
    // statuses. Waiting for a network that cannot answer used to mean a local
    // post could never be deleted at all.
    expect(deleteOutcomeForStatus(503)).toBe('local')
    expect(deleteOutcomeForStatus(408)).toBe('local')
    expect(deleteOutcomeForStatus(425)).toBe('local')
    expect(deleteOutcomeForStatus(429)).toBe('local')
  })

  it('a node-backed row stays on a transport failure (unknown, not removed)', () => {
    // Saying "removed" here made the tile vanish and come straight back on the
    // next refresh: the node still served the post.
    expect(deleteOutcomeForStatus(503, { nodeBacked: true })).toBe('failed')
    expect(deleteOutcomeForStatus(408, { nodeBacked: true })).toBe('failed')
    expect(deleteOutcomeForStatus(429, { nodeBacked: true })).toBe('failed')
    // A local-only row still gets its tombstone: there is no server row to wait for.
    expect(deleteOutcomeForStatus(503, { nodeBacked: false })).toBe('local')
  })

  it('a definitive refusal is a real failure, never hidden', () => {
    expect(deleteOutcomeForStatus(403)).toBe('failed')
    expect(deleteOutcomeForStatus(500)).toBe('failed')
    expect(deleteOutcomeForStatus(400)).toBe('failed')
  })
})