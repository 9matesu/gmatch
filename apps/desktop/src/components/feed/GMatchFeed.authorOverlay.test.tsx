// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GMatchFeed, type FeedPost } from './GMatchFeed';

vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(),
  playLike: vi.fn(),
  playWin: vi.fn(),
  playMsgReceive: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}), ok: true }));
  vi.stubGlobal('IntersectionObserver', class {
    observe() { } unobserve() { } disconnect() { }
  });
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
});

describe('GMatchFeed author header', () => {
  const identity = { orbitId: 'me', publicKeyHex: '1', privateKeyHex: '2' };

  const imagePost = {
    id: 'post-img-1',
    author_id: 'user-alice',
    author_name: 'Alice Wonder',
    author_avatar: 'https://example.com/alice.jpg',
    url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='675'%3E%3C/svg%3E",
    mime_type: 'image/svg+xml',
    created_at: new Date().toISOString(),
    like_count: 0,
    comment_count: 0,
  } as unknown as FeedPost;

  const videoPost = {
    id: 'post-vid-1',
    author_id: 'user-alice',
    author_name: 'Alice Wonder',
    url: 'https://example.com/clip.mp4',
    mime_type: 'video/mp4',
    created_at: new Date().toISOString(),
    like_count: 0,
    comment_count: 0,
  } as unknown as FeedPost;

  const renderFeed = (posts: FeedPost[], extra: Record<string, unknown> = {}) =>
    render(
      <GMatchFeed
        identity={identity as never}
        posts={posts}
        stories={[]}
        users={[]}
        {...extra}
      />,
    );

  it('renders the author header BEFORE the media (separate row, not overlaid)', () => {
    const { container } = renderFeed([imagePost]);
    const card = container.querySelector('article') as HTMLElement;
    expect(card).toBeTruthy();

    // The author header is the first block child (after an optional repost
    // banner): avatar + name row, then the media wrapper.
    const header = card.querySelector('.flex.items-center.justify-between') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.textContent).toContain('Alice Wonder');
    expect(header.querySelector('[title="View profile"]')).toBeTruthy();

    // Media comes after the header: the clickable media node carries
    // role="button".
    const media = card.querySelector('div[role="button"]') as HTMLElement;
    expect(media).toBeTruthy();
  });

  it('video cards use the same author header row, no top overlay on the player', () => {
    const { container } = renderFeed([videoPost]);
    const card = container.querySelector('article') as HTMLElement;
    expect(card.querySelector('video')).toBeTruthy();

    const header = card.querySelector('.flex.items-center.justify-between') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.textContent).toContain('Alice Wonder');

    // No author name inside the media wrapper (top-0 overlay).
    const media = card.querySelector('div[role="button"]') as HTMLElement;
    expect(media.querySelector('div.absolute.top-0')).toBeNull();
  });

  it('clicking the author avatar calls onSelectUser', () => {
    const onSelectUser = vi.fn();
    const { container } = renderFeed([imagePost], { onSelectUser });
    const card = container.querySelector('article') as HTMLElement;
    const avatar = card.querySelector('[title="View profile"]') as HTMLElement;
    expect(avatar).toBeTruthy();

    fireEvent.click(avatar);

    expect(onSelectUser).toHaveBeenCalledWith('user-alice');
    expect(screen.queryByPlaceholderText(/add a comment\.\.\./i)).toBeNull();
  });

  it('clicking the author name calls onSelectUser', () => {
    const onSelectUser = vi.fn();
    const { container } = renderFeed([imagePost], { onSelectUser });

    fireEvent.click(screen.getByText('Alice Wonder'));

    expect(onSelectUser).toHaveBeenCalledWith('user-alice');
    expect(screen.queryByPlaceholderText(/add a comment\.\.\./i)).toBeNull();
  });

  it('clicking the media does NOT open a comment lightbox', () => {
    const { container } = renderFeed([imagePost]);
    const card = container.querySelector('article') as HTMLElement;
    const mediaBox = card.querySelector('div[role="button"]') as HTMLElement;

    expect(screen.queryByPlaceholderText(/add a comment\.\.\./i)).toBeNull();

    fireEvent.click(mediaBox);

    // Inline expansion replaces the lightbox: no comment surface appears.
    expect(screen.queryByPlaceholderText(/add a comment\.\.\./i)).toBeNull();
  });
});
