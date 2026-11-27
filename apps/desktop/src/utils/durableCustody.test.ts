import { describe, expect, it } from 'vitest'
import { custodyStatus } from './durableCustody'

/**
 * The rule behind the "Stored on N devices" line.
 *
 * The count already includes THIS node (which holds the bytes it serves), so a
 * count of one means "only me" and must stay silent. Only a peer's signed,
 * read-back-verified receipt pushes the count to 2+. Nothing here may invent
 * custody: a HAVE, an in-flight download or an online peer never reaches this
 * function.
 */
describe('custodyStatus', () => {
  it('stays silent when this node is the only holder', () => {
    expect(custodyStatus(1)).toEqual({ holders: 1, label: null })
  })

  it('speaks once a peer proves it holds the bytes', () => {
    expect(custodyStatus(2)).toEqual({ holders: 2, label: 'Stored on 2 devices' })
  })

  it('counts every distinct proven holder', () => {
    expect(custodyStatus(5).label).toBe('Stored on 5 devices')
  })

  it('never claims replication from zero or a broken read', () => {
    expect(custodyStatus(0)).toEqual({ holders: 0, label: null })
    expect(custodyStatus(-3)).toEqual({ holders: 0, label: null })
    expect(custodyStatus(Number.NaN)).toEqual({ holders: 0, label: null })
  })

  it('floors a fractional count instead of rounding a claim up', () => {
    expect(custodyStatus(2.9).label).toBe('Stored on 2 devices')
  })
})
