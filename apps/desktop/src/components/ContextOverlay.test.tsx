// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextOverlay } from './ContextOverlay';

describe('ContextOverlay Custom Context Menu', () => {
  const defaultProps = {
    identity: null,
    friendsIds: [],
    toast: vi.fn(),
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue('pasted text'),
      },
    });
  });

  it('renders media context menu with video controls and save options', async () => {
    render(
      <ContextOverlay
        {...defaultProps}
        contextMenu={{
          x: 100,
          y: 100,
          type: 'media',
          data: {
            src: 'https://example.com/clip.mp4',
            isVideo: true,
          },
        }}
      />
    );

    expect(screen.getByText('Video')).toBeInTheDocument();
    expect(screen.getByText('Save Video As...')).toBeInTheDocument();
    expect(screen.getByText('Copy Video Link')).toBeInTheDocument();

    const copyBtn = screen.getByText('Copy Video Link');
    await userEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/clip.mp4');
    expect(defaultProps.toast).toHaveBeenCalledWith('Video link copied', 'info');
    expect(defaultProps.onDismiss).toHaveBeenCalled();
  });

  it('offers app + OS wallpaper entries using the original URL, hidden for avatars', async () => {
    const onSetWallpaper = vi.fn()
    const { rerender } = render(
      <ContextOverlay
        {...defaultProps}
        onSetWallpaper={onSetWallpaper}
        contextMenu={{
          x: 100,
          y: 100,
          type: 'media',
          data: {
            src: 'blob:https://app/transient',
            originalUrl: '/api/objects/abc123',
            isVideo: false,
          },
        }}
      />
    )
    await userEvent.click(screen.getByText('Set as app background'))
    expect(onSetWallpaper).toHaveBeenCalledWith('/api/objects/abc123', 'app', 'image/jpeg')
    await userEvent.click(screen.getByText('Set as OS wallpaper'))
    expect(onSetWallpaper).toHaveBeenCalledWith('/api/objects/abc123', 'os', 'image/jpeg')

    // Avatars/icons opt out: no wallpaper entries at all.
    rerender(
      <ContextOverlay
        {...defaultProps}
        onSetWallpaper={onSetWallpaper}
        contextMenu={{ x: 100, y: 100, type: 'media', data: { src: 'https://x/a.jpg', isVideo: false, noWallpaper: true } }}
      />
    )
    expect(screen.queryByText('Set as app background')).toBeNull()
    expect(screen.queryByText('Set as OS wallpaper')).toBeNull()
  })

  it('offers wallpaper entries on keepsake item menus', async () => {
    const onSetWallpaper = vi.fn()
    render(
      <ContextOverlay
        {...defaultProps}
        onSetWallpaper={onSetWallpaper}
        contextMenu={{
          x: 100,
          y: 100,
          type: 'item',
          data: { id: 'obj-9', content_url: '/api/objects/obj-9', mime_type: 'image/jpeg' },
        }}
      />
    )
    await userEvent.click(screen.getByText('Set as app background'))
    expect(onSetWallpaper).toHaveBeenCalledWith('/api/objects/obj-9', 'app', 'image/jpeg')
  })

  it('renders input context menu with cut, copy, paste, select all', async () => {    const input = document.createElement('input');
    input.value = 'hello world';

    render(
      <ContextOverlay
        {...defaultProps}
        contextMenu={{
          x: 200,
          y: 200,
          type: 'input',
          data: {
            element: input,
            hasSelection: true,
            value: 'hello world',
          },
        }}
      />
    );

    expect(screen.getByText('Cut')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Paste')).toBeInTheDocument();
    expect(screen.getByText('Select All')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();

    const pasteBtn = screen.getByText('Paste');
    await userEvent.click(pasteBtn);
    expect(defaultProps.onDismiss).toHaveBeenCalled();
  });

  it('renders selection context menu for highlighted text', async () => {
    render(
      <ContextOverlay
        {...defaultProps}
        contextMenu={{
          x: 150,
          y: 150,
          type: 'selection',
          data: { text: 'selected query' },
        }}
      />
    );

    expect(screen.getByText(/selected query/i)).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Select All')).toBeInTheDocument();
  });

  it('renders general context menu on background right click', () => {
    render(
      <ContextOverlay
        {...defaultProps}
        contextMenu={{
          x: 50,
          y: 50,
          type: 'general',
          data: {},
        }}
      />
    );

    expect(screen.getByText('Reload')).toBeInTheDocument();
    expect(screen.getByText('Copy Page URL')).toBeInTheDocument();
    expect(screen.getByText('Scroll to Top')).toBeInTheDocument();
  });
});
