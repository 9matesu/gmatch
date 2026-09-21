// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstagramPostModal } from './InstagramPostModal';
import type { FeedPost } from './GMatchFeed';

vi.mock('../../utils/sounds', () => ({ playPress: vi.fn(), playWin: vi.fn(), playMsgReceive: vi.fn() }));

vi.mock('../../utils/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../utils/api')>();
  const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  return {
    ...mod,
    orbitFetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'video/mp4' }),
      blob: async () => new Blob([mp4], { type: 'video/mp4' }),
    })),
  };
});

beforeEachSetup();

function beforeEachSetup() {
  vi.stubGlobal('IntersectionObserver', class {
    observe() { } unobserve() { } disconnect() { }
  });
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as never;
  window.HTMLMediaElement.prototype.pause = vi.fn() as never;
  window.HTMLMediaElement.prototype.load = vi.fn() as never;
  // jsdom has no createObjectURL: the signed-fetch leg needs it to mint URLs.
  let seq = 0;
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => `blob:obj-${++seq}`);
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
}

const identity = { orbitId: 'me-1' } as never;

function imagePost(): FeedPost {
  return {
    id: 'p-img', author_id: 'a-1', author_name: 'A', url: 'https://example.com/pic.jpg',
    mime_type: 'image/jpeg', caption: 'pic', created_at: new Date().toISOString(),
    like_count: 3, comment_count: 0,
  } as FeedPost;
}

function videoPost(): FeedPost {
  return {
    id: 'p-vid', author_id: 'a-1', author_name: 'A',
    url: 'https://example.com/fallback.jpg',
    mime_type: 'image/jpeg',
    media: [{ id: 'm-1', url: '/api/objects/vid-1', mime_type: 'video/mp4' }],
    caption: 'clip', created_at: new Date().toISOString(),
    like_count: 5, comment_count: 0,
  } as unknown as FeedPost;
}

describe('InstagramPostModal media', () => {
  it('plays extension-less object video from post.media[] instead of a broken image', async () => {
    const { waitFor } = await import('@testing-library/react');
    await act(async () => {
      render(<InstagramPostModal post={videoPost()} isOpen onClose={() => {}} identity={identity} />);
    });
    // Signed fetch resolves async: the dual-leg ObjectImage fetches the
    // object bytes (mocked mp4) and renders a real <video>, never a raw
    // <video src="/api/objects/..."> without auth.
    await waitFor(() => {
      const video = document.body.querySelector('video');
      expect(video).toBeInTheDocument();
    });
    const rawSrc = document.body.querySelector('video')?.getAttribute('src') || '';
    expect(rawSrc.startsWith('/api/objects/')).toBe(false);
    // No image fallback rendered for the video item
    expect(document.body.querySelector('.cursor-zoom-in')).not.toBeInTheDocument();
  });

  it('renders images through the image branch with no video element', async () => {
    await act(async () => {
      render(<InstagramPostModal post={imagePost()} isOpen onClose={() => {}} identity={identity} />);
    });
    expect(document.body.querySelector('video')).not.toBeInTheDocument();
    expect(document.body.querySelector('img')).toBeInTheDocument();
  });

  it('resets the carousel when a different post opens', async () => {
    const multi = {
      ...imagePost(), id: 'p-multi',
      mediaUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    } as FeedPost;
    const { rerender } = render(
      <InstagramPostModal post={multi} isOpen onClose={() => {}} identity={identity} />,
    );
    // Multi-item post: next-arrow present
    expect(document.body.querySelector('.lucide-chevron-right')).toBeInTheDocument();
    await act(async () => {
      rerender(<InstagramPostModal post={imagePost()} isOpen onClose={() => {}} identity={identity} />);
    });
    // Single-image post: no carousel arrows
    expect(document.body.querySelector('.lucide-chevron-right')).not.toBeInTheDocument();
    expect(document.body.querySelector('.lucide-chevron-left')).not.toBeInTheDocument();
  });

  it('renders immediate localPreviewUrl for freshly created posts', async () => {
    const freshPost = {
      id: 'p-fresh',
      author_id: 'a-1',
      author_name: 'A',
      url: '/api/objects/pending-id',
      localPreviewUrl: 'blob:fresh-preview-url',
      caption: 'fresh post',
      created_at: new Date().toISOString(),
      like_count: 0,
      comment_count: 0,
    } as unknown as FeedPost;

    await act(async () => {
      render(<InstagramPostModal post={freshPost} isOpen onClose={() => {}} identity={identity} />);
    });

    const img = document.body.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'blob:fresh-preview-url');
  });
});

describe('InstagramPostModal actions + font', () => {
  const likesButton = (): HTMLElement => {
    const el = [...document.body.querySelectorAll('button')].find((b) =>
      /^\d+ likes?$/.test((b.textContent || '').trim()),
    );
    if (!el) throw new Error('likes count button not found');
    return el as HTMLElement;
  };

  it('likes count uses body font (no font-mono) and opens likers', async () => {
    const onOpenLikers = vi.fn();
    await act(async () => {
      render(
        <InstagramPostModal
          post={imagePost()} isOpen onClose={() => {}} identity={identity}
          likeCount={3} onOpenLikers={onOpenLikers}
        />,
      );
    });
    const btn = likesButton();
    expect(btn.textContent).toContain('3 likes');
    expect(btn.className).not.toContain('font-mono');
    await userEvent.click(btn);
    expect(onOpenLikers).toHaveBeenCalledWith('p-img');
  });

  it('wires like / share / options buttons to handlers', async () => {
    const onToggleLike = vi.fn();
    const onOpenShare = vi.fn();
    const onOptionsClick = vi.fn();
    await act(async () => {
      render(
        <InstagramPostModal
          post={imagePost()} isOpen onClose={() => {}} identity={identity}
          onToggleLike={onToggleLike} onOpenShare={onOpenShare} onOptionsClick={onOptionsClick}
        />,
      );
    });
    const btnWithIcon = (cls: string): HTMLElement => {
      const el = document.body.querySelector(`button:has(.${cls})`);
      if (!el) throw new Error(`button with icon ${cls} not found`);
      return el as HTMLElement;
    };
    await userEvent.click(btnWithIcon('lucide-heart'));
    expect(onToggleLike).toHaveBeenCalledTimes(1);
    await userEvent.click(btnWithIcon('lucide-send'));
    expect(onOpenShare).toHaveBeenCalledTimes(1);
    await userEvent.click(btnWithIcon('lucide-ellipsis'));
    expect(onOptionsClick).toHaveBeenCalledTimes(1);
  });
});
