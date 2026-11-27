// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FollowersFollowingModal } from './FollowersFollowingModal'

/**
 * The profile's Followers/Following tabs are local-first.
 *
 * The node's `Followers` table is bookkeeping that lags behind what the peers
 * signed, so with the node unreachable the tabs read empty even though the
 * follow operations are sitting in the durable log — and a stale row could not
 * be masked. These tests drive the wired component: the node answers nothing,
 * the operation log supplies the edges, and both tabs still tell the truth.
 */
const state = vi.hoisted(() => ({
  edges: {
    followers: new Set<string>(),
    following: new Set<string>(),
    withdrawnFollowers: new Set<string>(),
    withdrawnFollowing: new Set<string>(),
  },
  orbitFetch: vi.fn(),
}))

vi.mock('../../hooks/usePeerFollows', () => ({ usePeerFollowEdges: () => state.edges }))
vi.mock('../../utils/api', () => ({ orbitFetch: state.orbitFetch }))

function nodeRows(followers: unknown[], following: unknown[] = []) {
  state.orbitFetch
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(followers) })
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(following) })
}

function renderModal(overrides: Partial<React.ComponentProps<typeof FollowersFollowingModal>> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    currentUserId: 'me',
    identity: { orbitId: 'me' } as never,
    users: [
      { id: 'peer-1', display_name: 'Kenny', tags: [] },
      { id: 'peer-2', display_name: 'Dana', tags: [] },
    ] as never,
    followingIds: [],
    ...overrides,
  }
  render(<FollowersFollowingModal {...props} />)
  return props
}

beforeEach(() => {
  state.edges = {
    followers: new Set<string>(),
    following: new Set<string>(),
    withdrawnFollowers: new Set<string>(),
    withdrawnFollowing: new Set<string>(),
  }
  state.orbitFetch.mockReset()
  // An unreachable node: both list calls fail. The operation log is the only
  // source, which is exactly the offline case this merge exists for.
  state.orbitFetch.mockRejectedValue(new Error('node unreachable'))
})

describe('FollowersFollowingModal (local-first profile lists)', () => {
  it('shows a follow the node never received', async () => {
    state.edges.followers = new Set(['peer-1'])
    renderModal()

    await waitFor(() => expect(screen.getByText('@Kenny')).toBeInTheDocument())
    expect(screen.getByText('1 Followers')).toBeInTheDocument()
  })

  it('masks a node follower the operations withdrew', async () => {
    nodeRows([{ id: 'ghost', display_name: 'Ghost' }])
    state.edges.withdrawnFollowers = new Set(['ghost'])
    renderModal()

    await waitFor(() => expect(screen.getByText('0 Followers')).toBeInTheDocument())
    expect(screen.queryByText('@Ghost')).toBeNull()
  })

  it('reads the Following tab from the operations too, and can act on the row', async () => {
    state.edges.following = new Set(['peer-2'])
    const props = renderModal({ followingIds: [], onToggleFollow: vi.fn() })

    fireEvent.click(screen.getByText('1 Following'))
    await waitFor(() => expect(screen.getByText('@Dana')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Follow'))
    expect(props.onToggleFollow).toHaveBeenCalledWith('peer-2')
  })

  it('keeps the node row when no operation disagrees, and marks a real follow', async () => {
    nodeRows([{ id: 'peer-1', display_name: 'Kenny' }])
    renderModal({ followingIds: ['peer-1'], onToggleFollow: vi.fn() })

    await waitFor(() => expect(screen.getByText('@Kenny')).toBeInTheDocument())
    expect(screen.getByText('Following')).toBeInTheDocument()
  })
})