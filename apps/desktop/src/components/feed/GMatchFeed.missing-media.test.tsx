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

  it('keeps the post on the timeline when its media is not on this device', () => {
    render(
      <GMatchFeed identity={identity} posts={posts} stories={[]} users={[]} feedSort="latest" />,
    );

    expect(screen.getByText('My own post without local bytes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'missing media' }));

    // The tile reports the miss; the row (author, caption, counts) stays.
    // Clicking the media also opens the comments side sheet, which repeats
    // the caption beside the timeline — the tile keeps its own copy too.
    expect(screen.getAllByText('My own post without local bytes').length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/hidden — media not on this device/),
    ).not.toBeInTheDocument();
  });
});
