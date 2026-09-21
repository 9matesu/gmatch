// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GMatchFeed } from './GMatchFeed';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}), ok: true }));
  vi.stubGlobal('IntersectionObserver', class {
    observe() { } unobserve() { } disconnect() { }
  });
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
});

describe('GMatchFeed video player on timeline', () => {
  const mockIdentity = { orbitId: 'test-user', publicKeyHex: '123', privateKeyHex: '456' };

  it('renders video with complete player controls on the timeline', async () => {
    const videoPost = {
      id: 'vid-post-1',
      author_id: 'author-1',
      author_name: 'Gooner',
      url: 'https://example.com/clip.mp4',
      mime_type: 'video/mp4',
      caption: 'Epic gameplay clip',
      tags: ['gaming'],
      created_at: new Date().toISOString(),
      like_count: 5,
      comment_count: 2,
    };

    let container: HTMLElement;
    await act(async () => {
      const res = render(
        <GMatchFeed
          identity={mockIdentity as never}
          posts={[videoPost as never]}
          stories={[]}
          users={[]}
        />
      );
      container = res.container;
    });

    // Video element rendered with source
    const video = container!.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('src', 'https://example.com/clip.mp4');

    // Controls should be rendered (video autoplays muted)
    expect(screen.getByLabelText(/pause|play/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/unmute|mute/i)).toBeInTheDocument();
    expect(screen.getByTitle(/playback speed/i)).toBeInTheDocument();
    expect(screen.getByTitle(/loop/i)).toBeInTheDocument();
    expect(screen.getByTitle(/expand to lightbox/i)).toBeInTheDocument();

    // The bottom control bar has opacity-100 due to alwaysShowControls
    const bottomControls = container!.querySelector('.bg-gradient-to-t');
    expect(bottomControls).toHaveClass('opacity-100');
  });

  it('clicking the video does NOT immediately open the lightbox modal, but toggles play', async () => {
    const videoPost = {
      id: 'vid-post-2',
      author_id: 'author-1',
      author_name: 'Gooner',
      url: 'https://example.com/clip.mp4',
      mime_type: 'video/mp4',
      caption: 'Timeline video',
      tags: [],
      created_at: new Date().toISOString(),
      like_count: 0,
      comment_count: 0,
    };

    let container: HTMLElement;
    await act(async () => {
      const res = render(
        <GMatchFeed
          identity={mockIdentity as never}
          posts={[videoPost as never]}
          stories={[]}
          users={[]}
        />
      );
      container = res.container;
    });

    const video = container!.querySelector('video')!;
    await userEvent.click(video);

    // Play was toggled on the video element
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();

    // Lightbox modal should NOT be opened
    expect(screen.queryByPlaceholderText(/add a comment\.\.\./i)).not.toBeInTheDocument();
  });

  it('clicking the dedicated expand button opens the lightbox modal for the video post', async () => {
    const videoPost = {
      id: 'vid-post-3',
      author_id: 'author-1',
      author_name: 'Gooner',
      url: 'https://example.com/clip.mp4',
      mime_type: 'video/mp4',
      caption: 'Expandable video post',
      tags: [],
      created_at: new Date().toISOString(),
      like_count: 0,
      comment_count: 0,
    };

    await act(async () => {
      render(
        <GMatchFeed
          identity={mockIdentity as never}
          posts={[videoPost as never]}
          stories={[]}
          users={[]}
        />
      );
    });

    const expandBtn = screen.getByTitle(/expand to lightbox/i);
    await userEvent.click(expandBtn);

    // Lightbox modal is opened showing the post caption and comment input
    expect(screen.getByPlaceholderText(/add a comment\.\.\./i)).toBeInTheDocument();
  });

  it('routes a legacy vault:// video repost through ObjectImage (localhost http), never raw vault:// or signed post-id fetch', async () => {
    (window as unknown as { gmatch: unknown }).gmatch = {
      vaultGet: vi.fn(async () => ({ local: null })),
      vaultHttpUrl: vi.fn(async (url: string) => ({
        local: url.startsWith('vault://') ? `http://127.0.0.1:9/v/${encodeURIComponent(url)}` : null,
      })),
    };
    const fetchSpy = vi.mocked(globalThis.fetch);
    const vaultPost = {
      id: 'vid-vault-1',
      author_id: 'author-1',
      author_name: 'Gooner',
      url: 'vault://f/clip123',
      mime_type: 'video/mp4',
      caption: 'Vault repost',
      tags: [],
      created_at: new Date().toISOString(),
      like_count: 0,
      comment_count: 0,
    };

    let container: HTMLElement;
    await act(async () => {
      const res = render(
        <GMatchFeed
          identity={mockIdentity as never}
          posts={[vaultPost as never]}
          stories={[]}
          users={[]}
        />
      );
      container = res.container;
    });

    const video = container!.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('src', expect.stringContaining('http://127.0.0.1'));
    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('/api/objects/vid-vault-1'))).toBe(false);
    expect(video!.getAttribute('src')).not.toMatch(/^vault:/);
  });
});
