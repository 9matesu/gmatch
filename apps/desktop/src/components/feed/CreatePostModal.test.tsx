// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreatePostModal } from './CreatePostModal';

vi.mock('../../utils/sounds', () => ({ playPress: vi.fn(), playWin: vi.fn(), playMsgReceive: vi.fn() }));
vi.mock('../../hooks/useCropper', () => ({ useCropper: () => ({ crop: vi.fn(), cropper: null }) }));
vi.mock('../CropModal', () => ({ isCropableImage: () => false }));

const identity = { orbitId: 'me-1' } as never;

async function openUrlTab() {
  render(<CreatePostModal identity={identity} onClose={() => {}} toast={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /paste url \/ gif/i }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('CreatePostModal URL uploads', () => {
  it('resolves twitter post links to direct media on paste', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ media_extended: [{ type: 'video', url: 'https://video.twimg.com/vid.mp4' }] }),
    } as unknown as Response);
    await openUrlTab();
    await userEvent.type(
      screen.getByPlaceholderText(/paste image, gif, mp4/i),
      'https://x.com/user/status/123',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
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
    await openUrlTab();
    await userEvent.type(
      screen.getByPlaceholderText(/paste image, gif, mp4/i),
      'https://www.redgifs.com/watch/abc123',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => {
      expect(screen.getByText(/video link attached/i)).toBeInTheDocument();
    });
    expect(document.body.querySelector('img')).not.toBeInTheDocument();
  });

  it('rejects non-https input with a warning toast', async () => {
    const toast = vi.fn();
    render(<CreatePostModal identity={identity} onClose={() => {}} toast={toast} />);
    await userEvent.click(screen.getByRole('button', { name: /paste url \/ gif/i }));
    await userEvent.type(screen.getByPlaceholderText(/paste image, gif, mp4/i), 'not a url');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/https/), 'warning');
  });
  it('renders story mode with Create Story title and Share Story button', () => {
    render(<CreatePostModal mode="story" identity={identity} onClose={() => {}} toast={vi.fn()} />);
    expect(screen.getByText(/Create Story/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Share Story/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload \/ files/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /camera/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /paste url/i })).toBeInTheDocument();
  });
});

