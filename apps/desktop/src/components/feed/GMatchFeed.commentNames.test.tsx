// @vitest-environment jsdom
// A signed rename is the actor's last statement. The feed resolves comment
// authors through the same accepted-name directory chat reads, so a peer's
// minted `User_<hex>` label never survives once we know their real name.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GMatchFeed, type FeedPost } from './GMatchFeed';
import { __resetNameDirectoryForTests, rememberName, rememberSignedName } from '../../game/nameDirectory';

vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(), playWin: vi.fn(), playMsgReceive: vi.fn(), playLikeOnce: vi.fn(),
}));
vi.mock('../../services/imageCache', () => ({
  resolveImage: vi.fn(async (u: string) => u),
  devFetchable: vi.fn(() => null),
  cachedImageFor: vi.fn(() => undefined),
}));

global.IntersectionObserver = vi.fn().mockImplementation((cb) => ({
  observe: vi.fn((el) => cb([{ isIntersecting: true, target: el }])),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})) as any;

const identity = { orbitId: 'me', publicKeyHex: 'aa', privateKeyHex: 'bb' } as never;

const post: FeedPost = {
  id: 'commented',
  author_id: 'peer-1',
  author_name: 'Peer One',
  created_at: new Date().toISOString(),
  caption: 'A post with a comment',
  url: '',
  like_count: 0,
  comment_count: 1,
  comments: [{
    id: 'c1', author_id: 'peer-1', author_name: 'User_1da964', text: 'nice',
    created_at: new Date().toISOString(), like_count: 0,
  }],
};

describe('GMatchFeed comment author names', () => {
  beforeEach(() => __resetNameDirectoryForTests());

  it('shows the accepted signed name instead of a minted fallback', async () => {
    rememberSignedName('peer-1', 'Renamed Peer');
    const { container } = render(
      <GMatchFeed identity={identity} posts={[post]} stories={[]} users={[]} />,
    );
    expect(await screen.findByText('Renamed Peer')).toBeInTheDocument();
    expect(screen.queryByText('User_1da964')).toBeNull();

    // The expanded thread reads the same one comment view.
    const card = container.querySelector('[data-post-id="commented"]') as HTMLElement;
    fireEvent.click(card.querySelector('button[aria-label="Comment"]') as HTMLElement);
    const expanded = container.querySelector('[data-expanded-post="commented"]') as HTMLElement;
    expect(expanded.textContent).toContain('Renamed Peer');
    expect(expanded.textContent).not.toContain('User_1da964');
  });

  it('never lifts a DM self-label into a comment author', async () => {
    rememberName('peer-1', 'I Am Definitely Alice');
    render(<GMatchFeed identity={identity} posts={[post]} stories={[]} users={[]} />);
    expect(screen.queryByText('I Am Definitely Alice')).toBeNull();
    expect(await screen.findByText('User_1da964')).toBeInTheDocument();
  });
});
