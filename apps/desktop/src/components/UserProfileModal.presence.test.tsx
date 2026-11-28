// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserProfileModal, profilePostsForAuthor } from './UserProfileModal';
import { __resetPresenceForTests, ingestSnapshot } from '../game/presenceStore';
import type { FeedPost } from './feed/GMatchFeed';
import type { User } from '@orbit/shared';

vi.mock('../utils/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/api')>(),
  orbitFetch: vi.fn(() => new Promise(() => {})),
  invalidateCache: vi.fn(),
}));
vi.mock('./feed/useProfilePostLightbox', () => ({
  useProfilePostLightbox: () => ({ openPost: vi.fn(), expandedNode: null, modals: null }),
}));
vi.mock('./ObjectImage', () => ({
  ObjectImage: ({ alt }: any) => <img alt={alt || ''} />,
}));

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const peer = (online: boolean, seen: string): User => ({
  id: 'cross-node-peer',
  display_name: 'Cross Node',
  online,
  last_seen: seen,
  publicKey: 'pk-peer',
  createdAt: ago(120_000),
} as User)

describe('UserProfileModal: one presence answer across surfaces', () => {
  beforeEach(() => { __resetPresenceForTests() })

  it('a roster-online cross-node peer reads Online even when the dashboard record is stale', () => {
    // The chat list trusts the live P2P roster flag; the profile used to ask
    // ONLY the dashboard-fed presence store, which never sees a cross-node
    // peer — so the same peer was "Active now" in chat and "Offline" here.
    ingestSnapshot([{ id: 'cross-node-peer', last_seen: ago(75_000), online: false }])
    const subject = peer(true, ago(5_000))
    render(
      <UserProfileModal
        user={subject}
        users={[subject]}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.queryByText('Offline')).toBeNull()
  })

  it('a peer still roster-online past the 60s dashboard window does not decay while the modal is open', () => {
    ingestSnapshot([{ id: 'cross-node-peer', last_seen: ago(70_000), online: false }])
    const subject = peer(true, ago(70_000))
    render(<UserProfileModal user={subject} users={[subject]} onClose={() => {}} />)
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('a roster-online peer reads Online even when its sighting is older than the roster window', () => {
    // ChatPlayerList calls this peer "Active now" straight from the roster's
    // online flag. The profile used to re-derive liveness from last_seen with
    // a 90s window, so a beacon arriving a little late made the SAME peer
    // read "Offline" here.
    ingestSnapshot([{ id: 'cross-node-peer', last_seen: ago(75_000), online: false }])
    const subject = peer(true, ago(120_000))
    render(<UserProfileModal user={subject} users={[subject]} onClose={() => {}} />)
    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.queryByText('Offline')).toBeNull()
  })

  it('does not fabricate a presence neither source knows', () => {
    const subject = peer(false, ago(10 * 60_000))
    render(<UserProfileModal user={subject} users={[]} onClose={() => {}} />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })
})

describe('UserProfileModal: profile post seeding', () => {
  const post = (id: string, author_id = 'cross-node-peer') => ({ id, author_id } as FeedPost)

  it('seeds from peer-replicated rows the timeline has not projected yet, deduped', () => {
    const rows = profilePostsForAuthor('cross-node-peer', [], [post('peer-1'), post('peer-2')])
    expect(rows.map((p) => p.id)).toEqual(['peer-1', 'peer-2'])
  })

  it('merges timeline and peer rows by id and ignores other authors', () => {
    const rows = profilePostsForAuthor(
      'cross-node-peer',
      [post('timeline-1'), post('other', 'someone-else')],
      [post('timeline-1'), post('peer-1')],
    )
    expect(rows.map((p) => p.id)).toEqual(['timeline-1', 'peer-1'])
  })

  it('the first open does not read "No posts yet" when a peer row exists', () => {
    const rows = profilePostsForAuthor('cross-node-peer', [], [post('peer-1')])
    render(<UserProfileModal user={peer(false, ago(5_000))} posts={rows} onClose={() => {}} />)
    expect(screen.getByText('Posts (1)')).toBeInTheDocument()
    expect(screen.queryByText('No posts yet.')).toBeNull()
  })
})
