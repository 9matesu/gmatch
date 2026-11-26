// @vitest-environment jsdom
// A row whose media bytes cannot be resolved is HIDDEN from the timeline — it
// must not sit there as an empty frame or a "No preview" strip. The hide is
// reversible: the row comes back the moment its bytes are available (a peer
// that just came online can deliver them), so it is a re-check, not a tombstone.
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { GMatchFeed } from './GMatchFeed';
import { PEER_ONLINE_EVENT } from '../../utils/p2pSwarm';

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

describe('GMatchFeed missing media', () => {
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

  const renderFeed = () =>
    render(<GMatchFeed identity={identity} posts={posts} stories={[]} users={[]} feedSort="latest" />);

  it('hides the row once its media reports a terminal miss', () => {
    const { container } = renderFeed();
    expect(container.querySelector('article')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'missing media' }));
    // No media -> no row: no empty frame, no "No preview" strip.
    expect(container.querySelector('article')).toBeNull();
  });

  it('promotes the row back when a peer comes online (reversible hide)', () => {
    const { container } = renderFeed();
    fireEvent.click(screen.getByRole('button', { name: 'missing media' }));
    expect(container.querySelector('article')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event(PEER_ONLINE_EVENT));
    });
    expect(container.querySelector('article')).not.toBeNull();
  });
});