// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GMatchFeed } from './GMatchFeed';

vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(),
  playWin: vi.fn(),
  playMsgReceive: vi.fn(),
  playLikeOnce: vi.fn(),
}));

vi.mock('../../services/imageCache', () => ({
  resolveImage: vi.fn(async (u: string) => u),
  devFetchable: vi.fn(() => null),
  cachedImageFor: vi.fn(() => undefined),
}));

// The swarm store: no bytes at first, then a blob once a "peer" seeds them.
const getLocalObject = vi.fn(async (_id: string) => null as Blob | null);
vi.mock('../../utils/p2pSwarm', () => ({
  getLocalObject: (id: string) => getLocalObject(id),
  PEER_ONLINE_EVENT: 'orbit-peer-online',
}));

// The real tile resolves over the network; this stub reports the terminal
// "media not on this device" result the tile produces after its vault probe +
// bounded swarm attempt.
vi.mock('../ObjectImage', () => ({
  ObjectImage: ({ onMediaUnavailable }: { onMediaUnavailable?: () => void }) => (
    <button type="button" onClick={() => onMediaUnavailable?.()}>
      missing media
    </button>
  ),
}));

global.IntersectionObserver = vi.fn().mockImplementation((cb) => ({
  observe: vi.fn((el) => cb([{ isIntersecting: true, target: el }])),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})) as any;

describe('GMatchFeed missing media (reversible)', () => {
  const identity = { orbitId: 'my-user-id', sign: vi.fn() } as any;
  const posts: any[] = [
    {
      id: 'missing-post',
      author_id: 'my-user-id',
      author_name: 'Me',
      created_at: new Date().toISOString(),
      caption: 'My own post without local bytes',
      url: '/api/objects/missing-post',
      like_count: 0,
      comment_count: 0,
    },
  ];

  it('hides the post when its media is dead and brings it back when bytes arrive', async () => {
    render(
      <GMatchFeed identity={identity} posts={posts} stories={[]} users={[]} feedSort="latest" />,
    );

    // Visible while the bytes are still in flight.
    expect(screen.getByText('My own post without local bytes')).toBeInTheDocument();

    // The tile reports the miss: the row is hidden (reversibly).
    fireEvent.click(screen.getByRole('button', { name: 'missing media' }));
    expect(screen.queryByText('My own post without local bytes')).not.toBeInTheDocument();

    // A peer came online and the swarm now holds the bytes: the row REAPPEARS.
    getLocalObject.mockResolvedValueOnce(new Blob(['x']));
    fireEvent(window, new Event('orbit-peer-online'));
    expect((await screen.findAllByText('My own post without local bytes')).length).toBeGreaterThan(0);
  });
});