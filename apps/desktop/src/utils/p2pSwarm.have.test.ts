// SWARM_HAVE: a peer's advertisement must be answered deliberately, not
// blindly. We ask only for ids this session already wants, never re-ask for
// bytes we hold or have in flight, and the wave is capped.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  announceHeldObjects,
  handleSwarmMessage,
  heldSwarmObjectIds,
  registerLocalObject,
  requestSwarmObject,
  cancelSwarmObject,
  setSwarmTransport,
  wantSwarmObject,
  wantedSwarmObjectIds,
  SWARM_HAVE_LIMIT,
  __resetLocalObjectCacheForTests,
  __resetWantedObjectsForTests,
  type SwarmMessage,
} from './p2pSwarm'

function capture(): { sent: SwarmMessage[] } {
  const box = { sent: [] as SwarmMessage[] }
  setSwarmTransport((msg) => {
    box.sent.push(msg)
  })
  return box
}

beforeEach(() => {
  __resetLocalObjectCacheForTests()
  __resetWantedObjectsForTests()
  setSwarmTransport(null)
})

describe('announceHeldObjects', () => {
  it('advertises the ids it holds', () => {
    registerLocalObject('obj-a', new Blob(['a']))
    registerLocalObject('obj-b', new Blob(['b']))
    const box = capture()

    expect(announceHeldObjects()).toBe(2)
    expect(box.sent).toHaveLength(1)
    expect(box.sent[0].type).toBe('SWARM_HAVE')
    expect((box.sent[0] as { ids: string[] }).ids.sort()).toEqual(['obj-a', 'obj-b'])
  })

  it('is bounded and silent when it holds nothing', () => {
    for (let i = 0; i < SWARM_HAVE_LIMIT + 5; i++) registerLocalObject(`obj-${i}`, new Blob([`${i}`]))
    const box = capture()

    expect(announceHeldObjects()).toBe(SWARM_HAVE_LIMIT)
    expect((box.sent[0] as { ids: string[] }).ids).toHaveLength(SWARM_HAVE_LIMIT)
    expect(heldSwarmObjectIds()).toHaveLength(SWARM_HAVE_LIMIT)
  })

  it('sends nothing without a transport', () => {
    registerLocalObject('obj-a', new Blob(['a']))
    expect(announceHeldObjects()).toBe(0)
  })
})

describe('answering a SWARM_HAVE', () => {
  it('requests only the ids it already wants', async () => {
    wantSwarmObject('obj-wanted')
    const box = capture()

    await handleSwarmMessage({ type: 'SWARM_HAVE', ids: ['obj-wanted', 'obj-unwanted'] })

    const wants = box.sent.filter((m) => m.type === 'SWARM_WANT')
    expect(wants).toHaveLength(1)
    expect((wants[0] as { id: string }).id).toBe('obj-wanted')

    cancelSwarmObject('obj-wanted')
  })

  it('never asks for an id it already holds', async () => {
    registerLocalObject('obj-held', new Blob(['held']))
    wantSwarmObject('obj-held')
    const box = capture()

    await handleSwarmMessage({ type: 'SWARM_HAVE', ids: ['obj-held'] })

    expect(box.sent.filter((m) => m.type === 'SWARM_WANT')).toHaveLength(0)
    expect(wantedSwarmObjectIds()).not.toContain('obj-held')
  })

  it('tolerates junk ids instead of throwing', async () => {
    wantSwarmObject('obj-wanted')
    const box = capture()

    await handleSwarmMessage({ type: 'SWARM_HAVE', ids: [null, 42, '', 'obj-wanted'] as unknown as string[] })

    expect(box.sent.filter((m) => m.type === 'SWARM_WANT')).toHaveLength(1)
    cancelSwarmObject('obj-wanted')
  })
})

describe('wants survive a timeout', () => {
  it('keeps the id wanted so a later HAVE can serve it', async () => {
    const box = capture()
    await expect(requestSwarmObject('obj-late', 10)).rejects.toThrow(/Timed out/)
    expect(box.sent.filter((m) => m.type === 'SWARM_WANT')).toHaveLength(1)
    expect(wantedSwarmObjectIds()).toContain('obj-late')
  })

  it('registers at most the cap of wanted ids', () => {
    for (let i = 0; i < 200; i++) wantSwarmObject(`obj-${i}`)
    expect(wantedSwarmObjectIds().length).toBeLessThanOrEqual(128)
    // The most recent wants are the ones kept.
    expect(wantedSwarmObjectIds()).toContain('obj-199')
  })
})
