// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../hooks/watchPartyStore', () => ({
  createPartyFromLocal: vi.fn(async () => ({ ok: true, partyId: 'p9' })),
  sendRoomFrame: vi.fn(),
}))
vi.mock('../../services/mediaForge', () => ({
  forgeMediaLocally: vi.fn(async () => ({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', contentHash: 'h', mimeType: 'video/mp4', sizeBytes: 10, localUrl: '', magnetUri: '' })),
  hashFileSha256: vi.fn(async () => 'f'.repeat(64)),
}))

import { createPartyFromLocal } from '../../hooks/watchPartyStore'
import { WatchLocalFile } from './WatchLocalFile'

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' } as never
const videoFile = () => new File(['0123456789'], 'clip.mp4', { type: 'video/mp4' })

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => vi.unstubAllGlobals())

describe('WatchLocalFile', () => {
  it('rejects non-video files before anything leaves the machine', () => {
    render(<WatchLocalFile identity={identity} party={null} roomName="" queueMode={false} onDone={() => {}} />)
    const input = screen.getByLabelText('Choose a local video file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'pic.jpg', { type: 'image/jpeg' })] } })
    expect(screen.getByText(/image, not a playable video/i)).toBeTruthy()
  })

  it('shows metadata + hash and requires consent before sharing', async () => {
    render(<WatchLocalFile identity={identity} party={null} roomName="Night" queueMode={false} onDone={() => {}} />)
    const input = screen.getByLabelText('Choose a local video file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [videoFile()] } })
    expect(await screen.findByText('clip.mp4')).toBeTruthy()
    expect(screen.getByText(/sha256:ffffffffffff/i)).toBeTruthy()
    const share = screen.getByRole('button', { name: /share and start party/i }) as HTMLButtonElement
    expect(share.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(share.disabled).toBe(false)
  })

  it('shares with consent: forge, register, then create the room', async () => {
    const onDone = vi.fn()
    render(<WatchLocalFile identity={identity} party={null} roomName="Night" queueMode={false} onDone={onDone} />)
    const input = screen.getByLabelText('Choose a local video file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [videoFile()] } })
    await screen.findByText('clip.mp4')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /share and start party/i }))
    await waitFor(() => expect(createPartyFromLocal).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({ name: 'clip.mp4', hash: 'f'.repeat(64) }),
      'Night',
    ))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
