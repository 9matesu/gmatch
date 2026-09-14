// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OrbitIdentity } from '@orbit/crypto'

vi.mock('../../utils/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  orbitFetch: vi.fn(),
}))
vi.mock('../../utils/sounds', () => ({ playPress: vi.fn() }))

import { orbitFetch } from '../../utils/api'
import { PostLikersModal } from './PostLikersModal'

const identity = { orbitId: 'me-1' } as OrbitIdentity

const json = (v: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 400, json: async () => v }) as unknown as Response

beforeEach(() => {
  vi.mocked(orbitFetch).mockReset()
})

describe('PostLikersModal', () => {
  it('fetches and renders list of users who liked the post', async () => {
    vi.mocked(orbitFetch).mockResolvedValue(
      json({
        likers: [
          { user_id: 'user-alice-123456789', display_name: 'Alice Wonder', pfp_url: null },
          { user_id: 'user-bob-987654321', display_name: 'Bob Builder', pfp_url: 'https://example.com/bob.jpg' },
        ],
      })
    )

    const onSelectUser = vi.fn()
    const onClose = vi.fn()

    render(
      <PostLikersModal
        postId="post-100"
        isOpen={true}
        onClose={onClose}
        identity={identity}
        onSelectUser={onSelectUser}
      />
    )

    expect(await screen.findByText('Alice Wonder')).toBeInTheDocument()
    expect(await screen.findByText('Bob Builder')).toBeInTheDocument()
    expect(orbitFetch).toHaveBeenCalledWith('/api/posts/post-100/likers', {}, identity)

    // Click Alice
    await userEvent.click(screen.getByText('Alice Wonder'))
    expect(onSelectUser).toHaveBeenCalledWith('user-alice-123456789')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders "No likes yet." when the post has zero likes', async () => {
    vi.mocked(orbitFetch).mockResolvedValue(json({ likers: [] }))
    render(
      <PostLikersModal
        postId="post-empty"
        isOpen={true}
        onClose={() => {}}
        identity={identity}
      />
    )

    expect(await screen.findByText('No likes yet.')).toBeInTheDocument()
  })

  it('closes on escape key or clicking close button', async () => {
    vi.mocked(orbitFetch).mockResolvedValue(json({ likers: [] }))
    const onClose = vi.fn()
    render(
      <PostLikersModal
        postId="post-1"
        isOpen={true}
        onClose={onClose}
        identity={identity}
      />
    )

    const closeBtn = await screen.findByRole('button', { name: /close/i })
    await userEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })
})
