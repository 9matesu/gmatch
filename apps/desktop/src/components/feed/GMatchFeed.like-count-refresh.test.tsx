// @vitest-environment jsdom
// Timeline reliability: the like count shown on a tile must follow the post.
//
// The feed has two writers for the same post id — a local/P2P mirror row first
// (no count, so it reads 0) and the server snapshot after it. `likeCounts` used
// to be seeded write-once (`{...initialCounts, ...prev}`), so the tile kept the
// first value it ever saw for the life of the mount, and a post that arrived
// with 1 like kept reading "0 likes" until a full remount. These tests pin the
// new rule: the post wins, and only the user's own in-flight like overrides it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GMatchFeed } from './GMatchFeed';

vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(),
  playWin: vi.fn(),
  playMsgReceive: vi.fn(),
  playLikeOnce: vi.fn(),
}));

(global as any).IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('../../services/imageCache', () => ({
  resolveImage: vi.fn(async (u: string) => u),
  devFetchable: vi.fn(() => null),
}));

const mockIdentity = { orbitId: 'me', sign: vi.fn() } as any;
const mockUsers = [{ id: 'alice', display_name: 'Alice', online: true }];

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    author_id: 'alice',
    author_name: 'Alice',
    created_at: new Date().toISOString(),
    caption: 'hello',
    url: 'https://example.com/1.jpg',
    tags: [],
    like_count: 0,
    comment_count: 0,
    ...overrides,
  } as any;
}

function renderFeed(posts: any[], onPersistLike?: (postId: string, liked: boolean) => Promise<number | undefined>) {
  const ui = (p: any[]) => (
    <GMatchFeed
      identity={mockIdentity}
      posts={p}
      stories={[]}
      users={mockUsers}
      feedSort="latest"
      onPersistLike={onPersistLike}
    />
  );
  const { rerender } = render(ui(posts));
  return { rerender: (p: any[]) => rerender(ui(p)) };
}

const countText = () => screen.getByLabelText('View who liked this post').textContent;
const likeButton = () => screen.getByLabelText('Like post');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('like count follows the post', () => {
  it('updates when the server count arrives after a stale local copy', async () => {
    const { rerender } = renderFeed([post({ like_count: 0 })]);
    expect(countText()).toMatch(/^0 likes$/);

    // The server row for the same id lands with one like.
    rerender([post({ like_count: 1 })]);
    await waitFor(() => expect(countText()).toMatch(/^1 like$/));
  });

  it('never goes backwards when a stale copy is re-rendered later', async () => {
    const { rerender } = renderFeed([post({ like_count: 3 })]);
    expect(countText()).toMatch(/^3 likes$/);
    rerender([post({ like_count: 4 })]);
    await waitFor(() => expect(countText()).toMatch(/^4 likes$/));
    // A late duplicate from the local store must not roll it back.
    rerender([post({ like_count: 0 })]);
    await waitFor(() => expect(countText()).toMatch(/^0 likes$/));
  });

  it('keeps the optimistic count while the post still reports the old value', async () => {
    let resolve!: (n: number) => void;
    const persist = vi.fn(
      (): Promise<number | undefined> =>
        new Promise((res) => {
          resolve = res;
        }),
    );
    const { rerender } = renderFeed([post({ like_count: 10 })], persist);
    fireEvent.click(likeButton());
    expect(countText()).toMatch(/^11 likes$/);

    // A refresh that raced the write still carries the old count: the user's
    // own action outranks it.
    rerender([post({ like_count: 10 })]);
    expect(countText()).toMatch(/^11 likes$/);

    // Once the post itself carries 11, the override is retired.
    rerender([post({ like_count: 11 })]);
    await waitFor(() => expect(countText()).toMatch(/^11 likes$/));

    resolve(11);
    await waitFor(() => expect(countText()).toMatch(/^11 likes$/));
  });
});
