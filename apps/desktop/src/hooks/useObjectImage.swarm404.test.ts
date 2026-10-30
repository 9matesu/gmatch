// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

// A DM attachment is registered on the SENDER's node only. The recipient's node
// has no row for it, so `/api/objects/<id>` 404s even though the sender is
// online and seeding the bytes. Resolution must ask the swarm before it gives
// up — otherwise "images from other people" never load in chat.
const swarm = vi.hoisted(() => ({
  PEER_ONLINE_EVENT: 'gmatch-peer-online',
  getLocalObject: vi.fn(async () => null),
  registerLocalObject: vi.fn(),
  requestSwarmObject: vi.fn(),
}))

vi.mock('../utils/p2pSwarm', () => swarm)
vi.mock('../services/vault', () => ({ vaultProbe: vi.fn(async () => ({ state: 'miss' })) }))
vi.mock('../utils/api', () => ({
  orbitFetch: vi.fn(async () => ({ ok: false, status: 404 }) as Response),
}))

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' }

describe('useObjectImage node-miss fallback', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { __resetObjectImageCacheForTests } = await import('./useObjectImage')
    __resetObjectImageCacheForTests()
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:from-swarm')
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  it('asks the swarm for bytes when the local node has no row for the id', async () => {
    swarm.requestSwarmObject.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }))
    const { useObjectImage } = await import('./useObjectImage')

    const h = renderHook(() => useObjectImage('dm-attachment-1', identity))
    await waitFor(() => expect(h.result.current.url).toBe('blob:from-swarm'))

    expect(swarm.requestSwarmObject).toHaveBeenCalledWith('dm-attachment-1', 5000)
    // Fetched bytes are cached under the id so a remount is instant.
    expect(swarm.registerLocalObject).toHaveBeenCalledWith('dm-attachment-1', expect.any(Blob))
    expect(h.result.current.failed).toBe(false)
    h.unmount()
  })

  it('fails honestly when no peer seeds the object either', async () => {
    swarm.requestSwarmObject.mockRejectedValueOnce(new Error('timeout'))
    const { useObjectImage } = await import('./useObjectImage')

    const h = renderHook(() => useObjectImage('dm-attachment-2', identity))
    await waitFor(() => expect(h.result.current.failed).toBe(true))
    expect(swarm.registerLocalObject).not.toHaveBeenCalled()
    h.unmount()
  })
})
