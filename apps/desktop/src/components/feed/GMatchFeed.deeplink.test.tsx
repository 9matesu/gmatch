// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

function post(id: string, caption: string) {
  return {
    id,
    author_id: 'alice',
    author_name: 'Alice',
    created_at: new Date().toISOString(),
    caption,
    url: 'https://example.com/1.jpg',
    tags: [],
    like_count: 0,
    comment_count: 0,
  } as any;
}

const composer = () => screen.queryByPlaceholderText('Add a comment...');
const articleOf = (id: string) => document.querySelector(`[data-post-id="${id}"]`);

function renderFeed(
  posts: any[],
  onResolveMissingPost?: (postId: string) => Promise<boolean>,
) {
  return render(
    <GMatchFeed
      identity={mockIdentity}
      posts={posts}
      stories={[]}
      users={mockUsers}
      feedSort="latest"
      onResolveMissingPost={onResolveMissingPost}
    />,
  );
}

const fireHashChange = () => act(() => { window.dispatchEvent(new Event('hashchange')); });

beforeEach(() => {
  window.location.hash = '';
  vi.clearAllMocks();
});

describe('feed deep links', () => {
  it('opens the target when the hash is already set before the list loads', async () => {
    window.location.hash = '#/feed?post=p2';
    renderFeed([post('p1', 'first'), post('p2', 'second')]);
    await waitFor(() => expect(composer()).toBeInTheDocument());
    expect(articleOf('p2')!.contains(composer()!)).toBe(true);
    window.location.hash = '';
  });

  it('opens the target for a hash-only navigation after the feed already loaded', async () => {
    // The regression: a permalink clicked inside the running app only fires
    // hashchange. The old effect was keyed on `posts` alone and never re-ran.
    renderFeed([post('p1', 'first'), post('p2', 'second')]);
    expect(composer()).toBeNull();

    window.location.hash = '#/feed?post=p2';
    fireHashChange();

    await waitFor(() => expect(composer()).toBeInTheDocument());
    expect(articleOf('p2')!.contains(composer()!)).toBe(true);
    window.location.hash = '';
  });

  it('switches to a different target when the hash names another post', async () => {
    window.location.hash = '#/feed?post=p1';
    renderFeed([post('p1', 'first'), post('p2', 'second')]);
    await waitFor(() => expect(articleOf('p1')!.contains(composer()!)).toBe(true));

    window.location.hash = '#/feed?post=p2';
    fireHashChange();

    await waitFor(() => expect(articleOf('p2')!.contains(composer()!)).toBe(true));
    window.location.hash = '';
  });

  it('requests a targeted read for a post outside the snapshot and opens it once it lands', async () => {
    const resolve = vi.fn(async () => false);
    const { rerender } = renderFeed([post('p1', 'first')], resolve);

    window.location.hash = '#/feed?post=p9';
    fireHashChange();

    await waitFor(() => expect(resolve).toHaveBeenCalledWith('p9'));
    expect(composer()).toBeNull();

    // The owner fetched it and merged it into the feed.
    rerender(
      <GMatchFeed
        identity={mockIdentity}
        posts={[post('p1', 'first'), post('p9', 'ninth')]}
        stories={[]}
        users={mockUsers}
        feedSort="latest"
        onResolveMissingPost={resolve}
      />,
    );

    await waitFor(() => expect(articleOf('p9')!.contains(composer()!)).toBe(true));
    // Asked exactly once, not once per list change.
    expect(resolve).toHaveBeenCalledTimes(1);
    window.location.hash = '';
  });

  it('still honours the gmatch-open-post event when the hash is unchanged', async () => {
    renderFeed([post('p1', 'first'), post('p2', 'second')]);
    window.location.hash = '#/feed?post=p1';
    fireHashChange();
    await waitFor(() => expect(articleOf('p1')!.contains(composer()!)).toBe(true));

    // A notification taps the same post again: the intent is new, so it reopens.
    act(() => {
      fireEvent(window, new CustomEvent('gmatch-open-post', { detail: { postId: 'p2' } }));
    });
    await waitFor(() => expect(articleOf('p2')!.contains(composer()!)).toBe(true));
    window.location.hash = '';
  });
});
