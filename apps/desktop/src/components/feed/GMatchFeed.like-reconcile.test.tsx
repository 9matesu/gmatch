// @vitest-environment jsdom
// Phase-0 evidence / Phase-1 regression: like mutation reconciliation.
// Each test pins one observable-state requirement from the spec:
// single persist per click, latest-mutation-wins on out-of-order resolve,
// rollback on failure. Written BEFORE the fix (TDD): failing now == bug proven.
import { StrictMode } from 'react';
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

function post() {
  return {
    id: 'p1',
    author_id: 'alice',
    author_name: 'Alice',
    created_at: new Date().toISOString(),
    caption: 'hello',
    url: 'https://example.com/1.jpg',
    tags: [],
    like_count: 10,
    comment_count: 0,
  } as any;
}

function renderFeed(persist: (postId: string, liked: boolean) => Promise<number | undefined>) {
  return render(
    <StrictMode>
      <GMatchFeed
        identity={mockIdentity}
        posts={[post()]}
        stories={[]}
        users={mockUsers}
        feedSort="latest"
        onPersistLike={persist}
      />
    </StrictMode>,
  );
}

const likeButton = () => screen.getByLabelText('Like post');
const countText = () => screen.getByLabelText('View who liked this post').textContent;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('like reconciliation (observable state sequence)', () => {
  it('fires exactly ONE persist per click, even under StrictMode', async () => {
    const persist = vi.fn(async (_id: string, _liked: boolean): Promise<number | undefined> => 11);
    renderFeed(persist);
    fireEvent.click(likeButton());
    await waitFor(() => expect(persist.mock.calls.length).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    // A single user click must produce a single mutation. The persist call
    // currently lives inside the setState updater, which StrictMode invokes
    // twice in dev — firing the mutation twice per click.
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith('p1', true);
  });

  it('latest mutation wins when responses resolve out of order', async () => {
    let resolvePost!: (n: number) => void;
    let resolveDelete!: (n: number) => void;
    const persist = vi.fn(
      (_id: string, liked: boolean): Promise<number | undefined> =>
        new Promise((res) => {
          if (liked) resolvePost = res;
          else resolveDelete = res;
        }),
    );
    renderFeed(persist);
    // like (10 -> 11 optimistic), then unlike (11 -> 10 optimistic)
    fireEvent.click(likeButton());
    fireEvent.click(likeButton());
    expect(countText()).toMatch(/^10 likes$/);
    // Server resolves in REVERSE order: DELETE first (9), POST last (11).
    // The visible state must follow the latest mutation (unlike -> 9),
    // never snap back to the stale POST result (11).
    await act(async () => { resolveDelete(9); });
    await act(async () => { resolvePost(11); });
    expect(countText()).toMatch(/^9 likes$/);
  });

  it('a failed persist rolls the optimistic state back', async () => {
    const persist = vi.fn(async (): Promise<number | undefined> => {
      throw new Error('network down');
    });
    const { container } = renderFeed(persist);
    fireEvent.click(likeButton());
    expect(countText()).toMatch(/^11 likes$/);
    await waitFor(() => expect(countText()).toMatch(/^10 likes$/));
    // Heart must also revert to unliked.
    const heart = container.querySelector('[aria-label="Like post"] svg');
    expect(heart?.getAttribute('class') ?? '').not.toMatch(/fill-rose-500/);
  });
});
