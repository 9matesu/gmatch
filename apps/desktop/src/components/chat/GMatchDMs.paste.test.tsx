// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { GMatchDMs } from './GMatchDMs'
import { generateIdentity } from '@orbit/crypto'
import type { ChatMessage } from '../../hooks/useP2P'

/**
 * Composer paste routing.
 *
 * The bug: the composer's <form>/<textarea> render OUTSIDE the DropZone, so a
 * paste there never reached the zone's handler — pasting an image into a
 * conversation did nothing, and a pasted link was dropped because the chat
 * DropZone had no onPasteUrl. These tests pin the routing so it cannot go back
 * to being inert.
 */

const identity = generateIdentity()
const PEER = { orbitId: 'peer-1', name: 'Kenny' }
const GROUP = {
  id: 'g1',
  name: 'Crew',
  owner_id: identity.orbitId,
  member_count: 1,
  is_member: 1,
}

// The component takes ~40 optional props; these tests only set a handful.
// `overrides` stays open so each test can add just what it needs, and the
// whole thing lands on the real prop type at the JSX call.
type Overrides = Parameters<typeof GMatchDMs>[0]

function baseProps(overrides: Partial<Overrides> = {}): Overrides {
  return {
    identity,
    activePmPeer: PEER,
    peers: [PEER],
    profilePics: {},
    onSelectPeer: vi.fn(),
    ...overrides,
  }
}

/** Fire a paste whose clipboard carries these files / text. */
function pasteInto(target: HTMLElement, opts: { files?: File[]; text?: string }) {
  const files = opts.files ?? []
  const text = opts.text ?? ''
  fireEvent.paste(target, {
    clipboardData: {
      items: files.map((f) => ({ kind: 'file', getAsFile: () => f })),
      getData: (t: string) => (t === 'text' ? text : ''),
      files,
    },
  })
}

const png = () => new File([new Uint8Array([1, 2, 3])], 'pasted.png', { type: 'image/png' })

describe('GMatchDMs composer paste', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    try { window.localStorage?.clear() } catch {}
  })

  it('routes a pasted image into the DM attachment flow', async () => {
    const onOpenAttachment = vi.fn()
    render(<GMatchDMs {...baseProps({ onOpenAttachment })} />)
    const composer = document.querySelector('textarea') as HTMLTextAreaElement
    expect(composer).toBeTruthy()

    const file = png()
    pasteInto(composer, { files: [file] })

    await waitFor(() => expect(onOpenAttachment).toHaveBeenCalledTimes(1))
    const [target, peerId, groupId, replyToId, files] = onOpenAttachment.mock.calls[0]
    expect(target).toBe('pm')
    expect(peerId).toBe(PEER.orbitId)
    expect(groupId).toBeUndefined()
    expect(replyToId).toBeUndefined()
    expect(files).toEqual([file])
  })

  it('routes a pasted image into the GROUP flow with the active group', async () => {
    const onOpenAttachment = vi.fn()
    render(<GMatchDMs {...baseProps({ onOpenAttachment, activeGroupId: GROUP.id, groups: [GROUP] })} />)
    const composer = document.querySelector('textarea') as HTMLTextAreaElement
    pasteInto(composer, { files: [png()] })

    await waitFor(() => expect(onOpenAttachment).toHaveBeenCalledTimes(1))
    const [target, peerId, groupId] = onOpenAttachment.mock.calls[0]
    expect(target).toBe('group')
    expect(groupId).toBe(GROUP.id)
    expect(peerId).toBeUndefined()
  })

  it('prefers an image when the clipboard has both a file and text', async () => {
    const onOpenAttachment = vi.fn()
    render(<GMatchDMs {...baseProps({ onOpenAttachment })} />)
    const composer = document.querySelector('textarea') as HTMLTextAreaElement
    pasteInto(composer, { files: [png()], text: 'https://example.com/page' })

    await waitFor(() => expect(onOpenAttachment).toHaveBeenCalled())
    const call = onOpenAttachment.mock.calls[0]
    expect(call[4]).toHaveLength(1)
    expect(call[5]).toBeUndefined()
  })

  it('routes a pasted image LINK as a url', async () => {
    const onOpenAttachment = vi.fn()
    render(<GMatchDMs {...baseProps({ onOpenAttachment })} />)
    const composer = document.querySelector('textarea') as HTMLTextAreaElement
    pasteInto(composer, { text: 'https://cdn.example/a.jpg' })

    await waitFor(() => expect(onOpenAttachment).toHaveBeenCalledTimes(1))
    const [target, peerId, groupId, replyToId, files, url] = onOpenAttachment.mock.calls[0]
    expect(target).toBe('pm')
    expect(peerId).toBe(PEER.orbitId)
    expect(files).toBeUndefined()
    expect(url).toBe('https://cdn.example/a.jpg')
  })

  it('leaves ordinary text pasting to the textarea', () => {
    // Not intercepted: the default insert must still happen, or pasting a
    // sentence into chat would be broken by this feature.
    const onOpenAttachment = vi.fn()
    render(<GMatchDMs {...baseProps({ onOpenAttachment })} />)
    const composer = document.querySelector('textarea') as HTMLTextAreaElement
    pasteInto(composer, { text: 'hello there' })
    expect(onOpenAttachment).not.toHaveBeenCalled()
  })

  it('refuses attachments in a sealed room and says so', async () => {
    const onOpenAttachment = vi.fn()
    const room = { id: 'r1', name: 'sealed', ownerId: identity.orbitId, members: [identity.orbitId], epoch: 1, seenAt: Date.now() }
    const roomMsg: ChatMessage = { id: 'm1', senderId: identity.orbitId, senderName: 'Me', text: 'hi', timestamp: Date.now() }
    render(
      <GMatchDMs
        {...baseProps({
          onOpenAttachment,
          showRooms: true,
          rooms: [room],
          activeRoomId: room.id,
          getRoomMessages: () => [roomMsg],
        })}
      />,
    )
    const composer = document.querySelector('textarea') as HTMLTextAreaElement
    pasteInto(composer, { files: [png()] })

    // Nothing is uploaded, and the player is told why rather than being met
    // with silence (which was the original bug).
    expect(onOpenAttachment).not.toHaveBeenCalled()
    await waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toMatch(/text only/i))
  })

  it('refuses attachments in the public lobby and says so', async () => {
    const onOpenAttachment = vi.fn()
    render(
      <GMatchDMs
        {...baseProps({
          onOpenAttachment,
          activePmPeer: { orbitId: 'global_lobby', name: 'Lobby Lounge (Everyone)' },
        })}
      />,
    )
    const composer = document.querySelector('textarea') as HTMLTextAreaElement
    pasteInto(composer, { files: [png()] })

    expect(onOpenAttachment).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(document.querySelector('[role="status"]')?.textContent).toMatch(/direct message or a group/i),
    )
  })

  it('Enter sends, Shift+Enter inserts a newline', () => {
    const onSendPm = vi.fn()
    render(<GMatchDMs {...baseProps({ onSendPm })} />)
    const composer = document.querySelector('textarea') as HTMLTextAreaElement

    fireEvent.change(composer, { target: { value: 'first' } })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
    expect(onSendPm).not.toHaveBeenCalled()

    fireEvent.change(composer, { target: { value: 'first' } })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false })
    expect(onSendPm).toHaveBeenCalledTimes(1)
  })
})
