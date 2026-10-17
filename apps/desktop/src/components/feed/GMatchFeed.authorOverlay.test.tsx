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

  it('rides the author identity ON the media, over a top scrim', () => {
    const { container } = renderFeed([imagePost]);
    const card = container.querySelector('article') as HTMLElement;
    expect(card).toBeTruthy();

    // No separate header row above the picture: the identity is an overlay.
    const overlay = card.querySelector('[data-testid="post-author-overlay"]') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.className).toMatch('absolute');
    expect(overlay.className).toMatch('top-0');
    expect(overlay.className).toMatch('bg-gradient-to-b');
    expect(overlay.textContent).toContain('Alice Wonder');
    expect(overlay.querySelector('[title="View profile"]')).toBeTruthy();

    // The overlay lives INSIDE the media node so it paints over the picture,
    // and the media keeps its own click surface (role="button").
    const mediaBox = card.querySelector('.group\\/post') as HTMLElement;
    expect(mediaBox.contains(overlay)).toBe(true);
    const media = card.querySelector('div[role="button"]') as HTMLElement;
    expect(media).toBeTruthy();
    expect(overlay.contains(media)).toBe(false);
  });

  it('uses the same overlay on video cards, with no quality badge', () => {
    const { container } = renderFeed([videoPost]);
    const card = container.querySelector('article') as HTMLElement;
    expect(card.querySelector('video')).toBeTruthy();

    const overlay = card.querySelector('[data-testid="post-author-overlay"]') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('Alice Wonder');
    expect(card.textContent).not.toContain('HD Video');
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

  it('clicking the media expands inline instead of opening a lightbox', () => {
    const { container } = renderFeed([imagePost]);
    const card = container.querySelector('article') as HTMLElement;
    const mediaBox = card.querySelector('div[role="button"]') as HTMLElement;

    fireEvent.click(mediaBox);

    // Inline expansion replaces the lightbox: the media node flips to
    // expanded and no modal dialog is mounted.
    expect(card.querySelector('[data-expanded="true"]')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
