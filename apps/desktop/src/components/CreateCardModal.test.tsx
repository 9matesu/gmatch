// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateCardModal } from './CreateCardModal';
import { createCardFromMedia } from '../utils/cardCollection';
import { forgeMediaLocally } from '../services/mediaForge';
import { mediaUrlToCachedFile } from '../utils/cacheMedia';

vi.mock('../utils/sounds', () => ({ playPress: vi.fn() }));
vi.mock('../utils/cacheMedia', () => ({ mediaUrlToCachedFile: vi.fn() }));
vi.mock('../services/mediaForge', () => ({ forgeMediaLocally: vi.fn() }));
vi.mock('../utils/cardCollection', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/cardCollection')>();
  return { ...mod, createCardFromMedia: vi.fn() };
});
vi.mock('./CropModal', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./CropModal')>();
  return { ...mod, isCropableImage: () => false };
});
vi.mock('../hooks/useCropper', () => ({
  useCropper: () => ({ crop: vi.fn(), cropper: <div data-testid="nested-crop">crop</div> }),
}));

const identity = { orbitId: 'me-1' } as never;

describe('CreateCardModal backdrop', () => {
  it('does NOT close on backdrop mousedown/click (typed input is preserved)', () => {
    const onClose = vi.fn();
    const { container } = render(<CreateCardModal identity={identity} onClose={onClose} />);
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT close on mousedown inside the nested crop dialog', () => {
    const onClose = vi.fn();
    render(<CreateCardModal identity={identity} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByTestId('nested-crop'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes via the X and Cancel buttons', () => {
    const onClose = vi.fn();
    render(<CreateCardModal identity={identity} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close card creator/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('CreateCardModal clicker origin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mediaUrlToCachedFile).mockResolvedValue(new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    vi.mocked(forgeMediaLocally).mockResolvedValue({ id: 'forged-1' } as never);
    vi.mocked(createCardFromMedia).mockResolvedValue({ id: 'card-1' } as never);
  });

  it('stamps the clicker origin on a card forged from a clicker keepsake', async () => {
    render(
      <CreateCardModal
        identity={identity}
        onClose={vi.fn()}
        initialMedia={{ url: 'gmcache://f/abc.jpg', tags: ['hentai'], name: 'Found foe' }}
      />,
    );
    expect(screen.getByTitle('Found in the clicker game')).toHaveTextContent('clicker!');
    await userEvent.click(screen.getByRole('button', { name: /create card/i }));
    await waitFor(() => expect(createCardFromMedia).toHaveBeenCalledTimes(1));
    const metadata = vi.mocked(createCardFromMedia).mock.calls[0][3];
    expect(metadata?.tags).toContain('clicker');
    expect(metadata?.tags).toContain('hentai');
  });

  it('leaves a normal card from a social object unflagged', async () => {
    render(
      <CreateCardModal
        identity={identity}
        onClose={vi.fn()}
        initialMedia={{ url: '/api/objects/obj-1', tags: ['hentai'], name: 'Upload' }}
      />,
    );
    expect(screen.queryByTitle('Found in the clicker game')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /create card/i }));
    await waitFor(() => expect(createCardFromMedia).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createCardFromMedia).mock.calls[0][3]?.tags).not.toContain('clicker');
  });
});
