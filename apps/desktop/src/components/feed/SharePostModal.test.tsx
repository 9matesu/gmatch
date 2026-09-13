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
import { SharePostModal } from './SharePostModal'
import type { FeedPost } from './GMatchFeed'

const identity = { orbitId: 'me-1' } as OrbitIdentity
const post = {
  id: 'p-9', author_id: 'me-1', author_name: 'Me', url: 'x.png',
  caption: 'hello world', created_at: '2026-01-01T00:00:00Z',
} as FeedPost

const json = (v: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 400, json: async () => v }) as unknown as Response

beforeEach(() => {
  vi.mocked(orbitFetch).mockReset()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn() },
    configurable: true,
  })
})

describe('SharePostModal (P3.4)', () => {
  it('sends a REAL DM with the post deep link, marks sent only on success', async () => {
    vi.mocked(orbitFetch).mockResolvedValue(json({ id: 'm-1' }))
    const toast = vi.fn()
    render(
      <SharePostModal
        post={post}
        onClose={() => {}}
        followingIds={['bob']}
        identity={identity}
        toast={toast}
      />,
    )
    await userEvent.click(await screen.findByRole('button', { name: /^send$/i }))
    await waitFor(() => {
      expect(orbitFetch).toHaveBeenCalledWith(
        '/api/pm/send',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"recipient_id":"bob"'),
        }),
        identity,
      )
    })
    const body = JSON.parse(vi.mocked(orbitFetch).mock.calls[0][1].body as string)
    expect(body.body).toContain('/p/p-9')
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/shared/i), 'success'))
    expect(screen.getByRole('button', { name: /sent/i })).toBeInTheDocument()
  })

  it('failed send does NOT fake success', async () => {
    vi.mocked(orbitFetch).mockResolvedValue(json({ error: 'nope' }, false))
    const toast = vi.fn()
    render(
      <SharePostModal
        post={post}
        onClose={() => {}}
        followingIds={['bob']}
        identity={identity}
        toast={toast}
      />,
    )
    await userEvent.click(await screen.findByRole('button', { name: /^send$/i }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/couldn't share/i), 'error'))
    expect(screen.queryByRole('button', { name: /sent/i })).not.toBeInTheDocument()
  })

  it('routes the DM through onSendDm (courier-aware App sender), never /api/pm/send', async () => {
    const onSendDm = vi.fn(async () => true)
    render(
      <SharePostModal
        post={post}
        onClose={() => {}}
        followingIds={['bob']}
        identity={identity}
        toast={vi.fn()}
        onSendDm={onSendDm}
      />,
    )
    await userEvent.click(await screen.findByRole('button', { name: /^send$/i }))
    await waitFor(() => expect(onSendDm).toHaveBeenCalledWith('bob', expect.stringContaining('/p/p-9')))
    // the dead legacy path must NOT be called
    expect(vi.mocked(orbitFetch)).not.toHaveBeenCalled()
  })

  it('copy link copies a post deep link, never the bare fly.dev root', async () => {
    render(
      <SharePostModal
        post={post}
        onClose={() => {}}
        followingIds={[]}
        identity={identity}
        toast={vi.fn()}
      />,
    )
    await userEvent.click(await screen.findByRole('button', { name: /copy link/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('/p/p-9'),
    )
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
    expect(copied).not.toBe('https://goonmatch.fly.dev')
  })
})
