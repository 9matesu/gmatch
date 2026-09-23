// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCropper } from './useCropper';

vi.mock('../utils/sounds', () => ({ playPress: vi.fn() }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

function Harness({ onHostMouseDown }: { onHostMouseDown: () => void }) {
  const { crop, cropper } = useCropper();
  return (
    <div data-testid="host" onMouseDown={onHostMouseDown}>
      <button
        type="button"
        onClick={() => void crop('data:image/jpeg;base64,AAA', { title: 'Crop card image' })}
      >
        open crop
      </button>
      {cropper}
    </div>
  );
}

describe('useCropper portal', () => {
  it('renders the crop dialog into document.body, outside the host tree', async () => {
    const onHostMouseDown = vi.fn();
    const { getByTestId } = render(<Harness onHostMouseDown={onHostMouseDown} />);
    fireEvent.click(screen.getByRole('button', { name: /open crop/i }));
    await waitFor(() => {
      expect(screen.getByText('Crop card image')).toBeInTheDocument();
    });
    // Portaled out: the host container must NOT contain the dialog, so host
    // backdrop-dismiss handlers can never observe its events.
    expect(getByTestId('host').textContent).not.toContain('Crop card image');
    // Mousedown inside the crop dialog must not bubble to host handlers
    // (this used to close CreateCardModal and wipe the whole form).
    fireEvent.mouseDown(screen.getByText('Crop card image'));
    expect(onHostMouseDown).not.toHaveBeenCalled();
  });
});
