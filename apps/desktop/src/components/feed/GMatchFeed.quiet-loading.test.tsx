// @vitest-environment jsdom
// Background work must not paint a label over the timeline: a strip fading in
// and out shifted the list and read as a flaky "nothing here" flash.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GMatchFeed } from './GMatchFeed'

vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(), playWin: vi.fn(), playMsgReceive: vi.fn(),
}));
vi.mock('../../services/imageCache', () => ({
  resolveImage: vi.fn(async (u: string) => u),
  devFetchable: vi.fn(() => null),
  cachedImageFor: vi.fn(() => undefined),
}));
vi.mock('../ObjectImage', () => ({ ObjectImage: () => <div data-testid="media-panel" /> }));

(global as any).IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
}));

const identity = { orbitId: 'me', publicKeyHex: 'aa', privateKeyHex: 'bb' } as never;
const post = {
  id: 'p1', author_id: 'me', author_name: 'Me', caption: 'a post',
  url: 'https://example.com/a.jpg', created_at: new Date().toISOString(),
  like_count: 0, comment_count: 0,
} as any;

describe('GMatchFeed quiet loading', () => {
  it('shows no transient loading label while stories and pages resolve', () => {
    render(
      <GMatchFeed
        identity={identity}
        posts={[post]}
        stories={[]}
        storiesLoading
        users={[]}
        isLoadingMore
        hasMore
      />,
    );
    expect(screen.queryByText(/Loading content/i)).toBeNull();
    expect(screen.queryByText(/Loading more moments/i)).toBeNull();
    expect(screen.queryByText(/Loading media|No preview/i)).toBeNull();
  });

  it('does not flash "Nothing to lay out yet." while grid pictures are measured', () => {
    render(
      <GMatchFeed identity={identity} posts={[post]} stories={[]} users={[]} feedLayout="grid" />,
    );
    expect(screen.queryByText(/Nothing to lay out yet/i)).toBeNull();
  });

  it('still explains a genuinely empty grid', () => {
    render(
      <GMatchFeed identity={identity} posts={[]} stories={[]} users={[]} feedLayout="grid" />,
    );
    expect(screen.getByText(/Nothing to lay out yet/i)).toBeTruthy();
  });
});
