// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreatePostModal } from './CreatePostModal';

vi.mock('../../utils/sounds', () => ({ playPress: vi.fn(), playWin: vi.fn(), playMsgReceive: vi.fn() }));
vi.mock('../../hooks/useCropper', () => ({ useCropper: () => ({ crop: vi.fn(), cropper: null }) }));
vi.mock('../CropModal', () => ({ isCropableImage: () => false }));

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

  it('renders story mode with Create Story title and Share Story button', () => {
    render(<CreatePostModal mode="story" identity={identity} onClose={() => {}} toast={vi.fn()} />);
    expect(screen.getByText(/Create Story/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Share Story/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload \/ files/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /camera/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pick media/i })).toBeInTheDocument();
  });
});
