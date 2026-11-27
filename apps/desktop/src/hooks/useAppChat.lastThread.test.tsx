// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { createElement, useRef, useState } from 'react'
import { generateIdentity } from '@orbit/crypto'
import { readScopedJson, scopedStorageKey } from '../utils/scopedSeen'
import { useAppChat, type AppChatContext } from './useAppChat'

const LAST_DM_PEER_KEY = 'gmatch_last_dm_peer_v1'
const identity = generateIdentity()

// The chat shell's real courier opens sockets and probes nodes; this test only
// cares about the remembered-thread pointer around deleteThread/restore.
const stubs = vi.hoisted(() => {
  const otherThread = [
    { id: 'm-other', peerId: 'other-peer', text: 'still here', ts: Date.now(), own: false },
  ]
  const threads: Record<string, typeof otherThread> = { 'other-peer': otherThread }
  const courier = {
    courierActive: true,
    threads,
    rooms: [],
    registerPeerKeys: () => {},
    pull: async () => {},
    threadFor: (peerId: string) => threads[peerId] ?? null,
    send: async () => null,
    markRead: () => {},
    edit: async () => false,
    remove: async () => true,
    react: async () => true,
    type: () => {},
    isTyping: () => false,
    meshSend: () => false,
    peerAddressable: () => false,
    roomMessages: () => [],
    createRoomWithId: () => null,
    inviteToRoom: async () => false,
    sayInRoom: async () => null,
  }
  return { courier }
})

vi.mock('./useCourierDms', () => ({ useCourierDms: () => stubs.courier }))
vi.mock('./useNotificationCenter', () => ({ useNotificationCenter: () => ({}) }))
vi.mock('./usePeerAttention', () => ({ usePeerAttention: () => [] }))
vi.mock('./usePeerNotificationReads', () => ({ usePeerNotificationReads: () => new Set<string>() }))
vi.mock('../game/presenceStore', () => ({
  usePresence: Object.assign(() => null, { getState: () => ({ ingest: () => {} }) }),
}))
vi.mock('../utils/mail-mode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/mail-mode')>()
  return { ...actual, cachedMailMode: () => 'courier', detectMailMode: async () => 'courier' }
})
vi.mock('../utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/api')>()
  return {
    ...actual,
    getApiBaseUrl: () => 'http://node.test',
    orbitFetch: vi.fn(async () => new Response('{}', { status: 200 })),
  }
})

const storage = new Map<string, string>()
beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
  })
})

function Harness({ chatOpen, mainView }: { chatOpen: boolean; mainView: MainViewType }) {
  const [pmPeer, setPmPeer] = useState<ChatPeer | null>({ id: 'deleted-peer', name: 'Deleted' } as ChatPeer)
  const [pmThreads, setPmThreads] = useState<AppChatContext['pmThreads']>([])
  const apiRef = useRef<ReturnType<typeof useAppChat> | null>(null)
  const ctx: AppChatContext = {
    identity,
    settings: {} as AppChatContext['settings'],
    toast: () => {},
    notifications: {} as AppChatContext['notifications'],
    users: [],
    usersRef: { current: [] },
    peers: [],
    nameRoster: {} as AppChatContext['nameRoster'],
    myProfile: { displayName: 'Me', tags: [] },
    chatOpen,
    mainView,
    handleSetMainView: () => {},
    roomSeen: {},
    setRoomSeen: () => {},
    dmSeen: {},
    setDmSeen: () => {},
    seenScopeRef: { current: identity.orbitId },
    stampDmSeen: () => {},
    pmPeer,
    setPmPeer,
    pmPeerId: pmPeer?.id ?? '',
    setPmMessagesByPeer: () => {},
    pmThreads,
    setPmThreads,
    pmUnreadCount: 0,
    setPmUnreadCount: () => {},
    attachmentModal: null,
    setAttachmentModal: () => {},
    setGroupPickerOpen: () => {},
    activeGroupId: null,
    setActiveGroupId: () => {},
    setActiveRoomId: () => {},
    chatMessages: [],
    lobby: {} as AppChatContext['lobby'],
    sendChatMessage: () => {},
  }
  apiRef.current = useAppChat(ctx)
  return createElement('div', null,
    createElement('span', { 'data-testid': 'peer' }, pmPeer?.id || 'none'),
    createElement('span', { 'data-testid': 'threads' }, pmThreads.map((t) => t.peer_id).join(',')),
    createElement('button', {
      'data-testid': 'back',
      onClick: () => setPmPeer(null),
    }, 'back'),
    createElement('button', {
      'data-testid': 'delete',
      onClick: () => { void apiRef.current?.deleteThread('deleted-peer') },
    }, 'delete'),
  )
}

type MainViewType = AppChatContext['mainView']
type ChatPeer = AppChatContext['pmPeer']

describe('useAppChat last-thread pointer', () => {
  it('restores on chat open, but not after the remembered thread is deleted', async () => {
    const { getByTestId, rerender } = render(createElement(Harness, { chatOpen: false, mainView: 'feed' }))
    const key = scopedStorageKey(LAST_DM_PEER_KEY, identity.orbitId)
    await waitFor(() => expect(storage.get(key)).toContain('deleted-peer'))
    // A valid thread remains, so "no restore" is distinguishable from a broken list.
    await waitFor(() => expect(getByTestId('threads').textContent).toContain('other-peer'))

    // Back to the list, close chat, reopen: the previous task's behaviour holds.
    await act(async () => { getByTestId('back').click() })
    expect(getByTestId('peer').textContent).toBe('none')
    rerender(createElement(Harness, { chatOpen: false, mainView: 'feed' }))
    rerender(createElement(Harness, { chatOpen: true, mainView: 'messages' }))
    await waitFor(() => expect(getByTestId('peer').textContent).toBe('deleted-peer'))

    // Delete the open thread: it must clear the stored pointer, not just the view.
    await act(async () => { getByTestId('delete').click() })
    await waitFor(() => expect(getByTestId('peer').textContent).toBe('none'))
    expect(readScopedJson<unknown>(LAST_DM_PEER_KEY, identity.orbitId, 'missing')).toBeNull()

    // Reopening chat lands on the thread list, never the deleted id.
    rerender(createElement(Harness, { chatOpen: false, mainView: 'feed' }))
    rerender(createElement(Harness, { chatOpen: true, mainView: 'messages' }))
    await act(async () => { await Promise.resolve() })
    expect(getByTestId('peer').textContent).toBe('none')
    expect(getByTestId('threads').textContent).toContain('other-peer')
  })
})
