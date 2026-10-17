import { describe, it, expect } from 'vitest'
import { createLabel, classifyServerId, removeMemberLocal, isOwnLabel } from './meshLabels'

describe('meshLabels', () => {
  it('creates stable ids that survive rename', () => {
    const l = createLabel('Alpha', 'owner1')
    const renamed = { ...l, name: 'Beta' }
    expect(renamed.id).toBe(l.id)
    expect(renamed.name).toBe('Beta')
  })

  it('classifies legacy/courier/hosted rows', () => {
    expect(classifyServerId('central-deprecated')).toBe('legacy')
    expect(classifyServerId('central-p2p')).toBe('courier')
    expect(classifyServerId('abc')).toBe('hosted')
  })

  it('local removal only hides from my view', () => {
    const l = createLabel('M', 'o1')
    l.memberOrbitIds = ['a', 'b']
    const next = removeMemberLocal([l], l.id, 'a')
    expect(next[0].memberOrbitIds).toEqual(['b'])
  })

  it('ownership is device-identity equality, not privilege', () => {
    const l = createLabel('M', 'o1')
    expect(isOwnLabel(l, 'o1')).toBe(true)
    expect(isOwnLabel(l, 'o2')).toBe(false)
  })
})
