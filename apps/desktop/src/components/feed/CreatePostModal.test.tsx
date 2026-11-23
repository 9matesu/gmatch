// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreatePostModal } from './CreatePostModal';

vi.mock('../../utils/sounds', () => ({ playPress: vi.fn(), playWin: vi.fn(), playMsgReceive: vi.fn() }));
vi.mock('../../hooks/useCropper', () => ({ useCropper: () => ({ crop: vi.fn(), cropper: null }) }));
vi.mock('../CropModal', () => ({ isCropableImage: () => false }));

// The forge is mocked at module level (a vi.spyOn on the namespace does NOT
// intercept the component's static import, so the spy never fired).
const forgeMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/mediaForge', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  forgeMediaLocally: forgeMock,
}));

const identity = { orbitId: 'me-1' } as never;

/** B7: URL entry now flows through the shared media picker. */
async function pickUrl(url: string, toast = vi.fn()) {
  render(<CreatePostModal identity={identity} onClose={() => {}} toast={toast} />);
  await userEvent.click(screen.getByRole('button', { name: /pick media/i }));
  await userEvent.click(await screen.findByRole('button', { name: /from your media, this device, or a link/i }));
  await userEvent.click(await screen.findByRole('button', { name: 'Paste URL' }));
  await userEvent.type(await screen.findByPlaceholderText('https://…'), url);
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await userEvent.click(screen.getByRole('button', { name: 'Use this media' }));
  return toast;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  // jsdom has no createObjectURL; the file path mints a preview URL.
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:preview');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  // Default: every item forges successfully. Individual tests override.
  forgeMock.mockReset();
  forgeMock.mockImplementation(async (file: File) => ({
    id: 'forged-' + file.name,
    contentHash: 'h',
    mimeType: file.type || 'image/png',
    sizeBytes: file.size,
    localUrl: 'blob:local',
    magnetUri: '',
  }));
});

describe('CreatePostModal URL uploads', () => {
  it('resolves twitter post links to direct media through the picker', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ media_extended: [{ type: 'video', url: 'https://video.twimg.com/vid.mp4' }] }),
    } as unknown as Response);
    await pickUrl('https://x.com/user/status/123');
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.vxtwitter.com'),
        expect.anything(),
      );
    });
    // Resolved direct mp4 previews as video, not a broken image
    await waitFor(() => {
      expect(document.body.querySelector('video')).toBeInTheDocument();
    });
  });

  it('accepts redgifs watch links as video placeholders for server resolution', async () => {
    await pickUrl('https://www.redgifs.com/watch/abc123');
    await waitFor(() => {
      expect(screen.getByText(/video link attached/i)).toBeInTheDocument();
    });
    expect(document.body.querySelector('img')).not.toBeInTheDocument();
  });

  it('puts a plain page link in the written body instead of failing as media', async () => {
    // The share path proxies every URL as an image, so an article link used to
    // die with "Could not fetch or validate the URL" and the post could not be
    // made at all. A link is content, not bytes: it belongs in the caption.
    await pickUrl('https://example.com/some-article');
    await waitFor(() => {
      expect(screen.getByDisplayValue(/https:\/\/example\.com\/some-article/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/video link attached/i)).toBeNull();
    expect(document.body.querySelector('img')).not.toBeInTheDocument();
  });

  it('rejects unusable URL input in the picker with an inline reason', async () => {
    const toast = vi.fn();
    render(<CreatePostModal identity={identity} onClose={() => {}} toast={toast} />);
    await userEvent.click(screen.getByRole('button', { name: /pick media/i }));
    await userEvent.click(await screen.findByRole('button', { name: /from your media, this device, or a link/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Paste URL' }));
    await userEvent.type(await screen.findByPlaceholderText('https://…'), 'not a url');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    // The picker gates before anything attaches; nothing reaches the post.
    expect(screen.getByRole('alert').textContent).toMatch(/not a usable/i);
    expect(toast).not.toHaveBeenCalled();
    expect(screen.queryByText(/video link attached/i)).toBeNull();
  });

  /**
   * A multi-image post is a loop, and one unreadable file used to throw out of
   * the whole loop - so a carousel of three with one bad entry posted NOTHING.
   * Each item is now isolated: the bad one is counted, the good ones publish.
   */
  it('a failing item does not discard the rest of the carousel', async () => {
    // First item's bytes fail to forge; the second must still publish.
    forgeMock.mockImplementationOnce(async () => {
      throw new Error('bad bytes');
    });

    const toast = vi.fn();
    render(<CreatePostModal identity={identity} onClose={() => {}} toast={toast} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const a = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    const b = new File([new Uint8Array([4, 5, 6])], 'b.png', { type: 'image/png' });
    await userEvent.upload(input, [a, b]);

    await userEvent.click(screen.getByRole('button', { name: /share/i }));

    // Both items were attempted despite the first rejecting...
    await waitFor(() => expect(forgeMock).toHaveBeenCalledTimes(2));
    // ...and the good one still produced a post.
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringMatching(/shared|story/i), 'success'),
    );
  });

  it('renders story mode with Create Story title and Share Story button', () => {
    render(<CreatePostModal mode="story" identity={identity} onClose={() => {}} toast={vi.fn()} />);
    expect(screen.getByText(/Create Story/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Share Story/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload \/ files/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /camera/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pick media/i })).toBeInTheDocument();
  });
});
