// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilePicModal } from './ProfilePicModal';

// Mock useCropper hook
vi.mock('../../hooks/useCropper', () => ({
  useCropper: () => ({
    crop: vi.fn().mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,cropped', file: null }),
    cropper: null,
  }),
}));

// Mock sounds
vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(),
  playWin: vi.fn(),
}));

// Mock fileToThumbDataUrl
vi.mock('../../utils/profile', () => ({
  fileToThumbDataUrl: vi.fn().mockImplementation(async () => 'data:image/jpeg;base64,thumb'),
}));

describe('ProfilePicModal', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      blob: vi.fn().mockResolvedValue(new Blob(['fake'], { type: 'image/jpeg' })),
    }) as unknown as typeof fetch;
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <ProfilePicModal isOpen={false} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders portaled into document.body when isOpen is true', () => {
    render(
      <ProfilePicModal isOpen={true} currentPfp="https://example.com/old.png" onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(screen.getByText('Profile photo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    const backdrop = document.body.querySelector('.fixed.inset-0');
    expect(backdrop).toBeInTheDocument();
  });

  it('does NOT close on backdrop click (staged photo/URL is preserved)', async () => {
    const onClose = vi.fn();
    render(
      <ProfilePicModal isOpen={true} onClose={onClose} onSave={vi.fn()} />
    );
    const backdrop = document.body.querySelector('.fixed.inset-0');
    expect(backdrop).toBeInTheDocument();
    if (backdrop) {
      await userEvent.click(backdrop);
      expect(onClose).not.toHaveBeenCalled();
    }
  });

  it('does not close when clicking inside dialog card', async () => {
    const onClose = vi.fn();
    render(
      <ProfilePicModal isOpen={true} onClose={onClose} onSave={vi.fn()} />
    );
    await userEvent.click(screen.getByText('Profile photo'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape key', async () => {
    const onClose = vi.fn();
    render(
      <ProfilePicModal isOpen={true} onClose={onClose} onSave={vi.fn()} />
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('allows entering an image URL and applying', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <ProfilePicModal isOpen={true} currentPfp="" onClose={onClose} onSave={onSave} />
    );
    // Switch to URL tab
    await userEvent.click(screen.getByRole('button', { name: 'URL' }));
    const urlInput = screen.getByPlaceholderText('https://example.com/photo.gif');
    await userEvent.type(urlInput, 'https://example.com/avatar.jpg');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onSave).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
