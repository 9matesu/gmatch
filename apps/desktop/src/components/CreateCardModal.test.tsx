// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CreateCardModal } from './CreateCardModal';

vi.mock('../utils/sounds', () => ({ playPress: vi.fn() }));
vi.mock('../utils/cacheMedia', () => ({ mediaUrlToCachedFile: vi.fn() }));
vi.mock('../services/mediaForge', () => ({ forgeMediaLocally: vi.fn() }));
vi.mock('../utils/cardCollection', () => ({ createCardFromMedia: vi.fn() }));
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
