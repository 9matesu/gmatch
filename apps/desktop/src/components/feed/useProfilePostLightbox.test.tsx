// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useProfilePostLightbox } from './useProfilePostLightbox';
import type { FeedPost } from './GMatchFeed';

vi.mock('../../utils/sounds', () => ({ playPress: vi.fn(), playWin: vi.fn(), playMsgReceive: vi.fn() }));
vi.mock('../../utils/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  orbitFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ likers: [] }) }),
  postShareUrl: (id: string) => `https://api.test/p/${id}`,
}));

vi.stubGlobal('IntersectionObserver', class {
  observe() { } unobserve() { } disconnect() { }
});
window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as never;
window.HTMLMediaElement.prototype.pause = vi.fn() as never;
window.HTMLMediaElement.prototype.load = vi.fn() as never;

const identity = { orbitId: 'me-1' } as never;

const postA = {
  id: 'prof-1', author_id: 'me-1', author_name: 'Me',
  url: 'https://example.com/pic.jpg', mime_type: 'image/jpeg',
  caption: 'hello', created_at: new Date().toISOString(),
  like_count: 0, comment_count: 0,
} as FeedPost;

const postB = {
  id: 'prof-2', author_id: 'me-1', author_name: 'Me',
  url: 'https://example.com/pic2.jpg', mime_type: 'image/jpeg',
  caption: 'world', created_at: new Date().toISOString(),
  like_count: 3, comment_count: 0,
} as FeedPost;

function Harness({ onPersistLike }: { onPersistLike?: (id: string, liked: boolean) => Promise<number | undefined> }) {
  const { openPost, closePost, expandedNode, modals } = useProfilePostLightbox({ identity, onPersistLike });
  return (
    <div>
      <button type="button" onClick={() => openPost(postA)}>open-a</button>
      <button type="button" onClick={() => openPost(postB)}>open-b</button>
      <button type="button" onClick={() => closePost()}>close</button>
      <div data-testid="grid">grid</div>
      {expandedNode}
      {modals}
    </div>
  );
}

describe('useProfilePostLightbox (inline expansion, no modal)', () => {
  const likesButton = (): HTMLElement => {
    const el = [...document.body.querySelectorAll('button')].find((b) =>
      /^\d+ likes?$/.test((b.textContent || '').trim()),
    );
    if (!el) throw new Error('likes count button not found');
    return el as HTMLElement;
  };

  it('openPost expands the post inline next to the grid — no dialog', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'open-a' }));
    const card = document.body.querySelector('article[data-expanded-post="prof-1"]');
    expect(card).not.toBeNull();
    // Comment composer lives inside the expanded card.
    expect(await screen.findByPlaceholderText(/add a comment/i)).toBeInTheDocument();
    // No modal dialog anywhere.
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closePost collapses the expanded card', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'open-a' }));
    await screen.findByPlaceholderText(/add a comment/i);
    await userEvent.click(screen.getByRole('button', { name: 'close' }));
    await waitFor(() =>
      expect(document.body.querySelector('article[data-expanded-post]')).toBeNull(),
    );
  });

  it('opening a second post replaces the first (one at a time)', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'open-a' }));
    await screen.findByPlaceholderText(/add a comment/i);
    await userEvent.click(screen.getByRole('button', { name: 'open-b' }));
    await waitFor(() =>
      expect(document.body.querySelector('article[data-expanded-post="prof-2"]')).not.toBeNull(),
    );
    expect(document.body.querySelector('article[data-expanded-post="prof-1"]')).toBeNull();
    expect(document.body.querySelectorAll('article[data-expanded-post]').length).toBe(1);
  });

  it('expanded card: like toggles count and persists', async () => {
    const onPersistLike = vi.fn(async () => 1);
    render(<Harness onPersistLike={onPersistLike} />);
    await userEvent.click(screen.getByRole('button', { name: 'open-a' }));
    expect(likesButton().textContent).toContain('0 likes');
    const likeBtn = document.body.querySelector('button:has(.lucide-heart)') as HTMLElement;
    await userEvent.click(likeBtn);
    await waitFor(() => expect(likesButton().textContent).toContain('1 like'));
    expect(onPersistLike).toHaveBeenCalledWith('prof-1', true);
  });

  it('options button opens the linked options sheet', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'open-a' }));
    await screen.findByPlaceholderText(/add a comment/i);
    const optionsBtn = document.body.querySelector('button:has(.lucide-ellipsis)') as HTMLElement;
    await userEvent.click(optionsBtn);
    expect(await screen.findByText(/copy link/i)).toBeInTheDocument();
    expect(await screen.findByText(/repost to profile/i)).toBeInTheDocument();
  });

  it('send button opens the share sheet', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'open-a' }));
    await screen.findByPlaceholderText(/add a comment/i);
    const sendBtn = document.body.querySelector('button:has(.lucide-send)') as HTMLElement;
    await userEvent.click(sendBtn);
    expect(await screen.findByText(/share post/i)).toBeInTheDocument();
  });
});
