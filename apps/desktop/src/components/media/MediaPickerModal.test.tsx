// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaPickerModal, useMediaPicker } from './MediaPickerModal';

const png = new File(['x'], 'pic.png', { type: 'image/png' });
const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' });

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mock') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MediaPickerModal', () => {
  it('shows only the requested source panes', () => {
    render(<MediaPickerModal options={{ sources: ['url'] }} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Paste URL')).toBeTruthy();
    expect(screen.queryByText('Your media')).toBeNull();
    expect(screen.queryByText('Upload')).toBeNull();
  });

  it('rejects a non-URL string, previews a valid one, and returns the selection', () => {
    const onPick = vi.fn();
    render(<MediaPickerModal options={{ sources: ['url'] }} onPick={onPick} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('https://…') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'not a url' } });
    fireEvent.click(screen.getByText('Preview'));
    expect(screen.getByRole('alert').textContent).toMatch(/not a usable/i);
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'https://x.com/a.png' } });
    fireEvent.click(screen.getByText('Preview'));
    const img = screen.getByAltText('Selected media preview') as HTMLImageElement;
    expect(img.src).toBe('https://x.com/a.png');

    fireEvent.click(screen.getByText('Use this media'));
    expect(onPick).toHaveBeenCalledWith({ kind: 'url', url: 'https://x.com/a.png', source: 'url' });
  });

  it('takes an accepted file (upload pane) and hands the caller a File selection', () => {
    const onPick = vi.fn();
    render(<MediaPickerModal options={{ sources: ['upload'] }} onPick={onPick} onClose={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [png] } });
    expect(screen.getByAltText('Selected media preview')).toBeTruthy();
    fireEvent.click(screen.getByText('Use this media'));
    expect(onPick).toHaveBeenCalledTimes(1);
    const sel = onPick.mock.calls[0][0];
    expect(sel.kind).toBe('file');
    expect(sel.file).toBe(png);
    expect(sel.previewUrl).toBe('blob:mock');
  });

  it('blocks files outside the accepted kinds with an inline reason', () => {
    render(<MediaPickerModal options={{ sources: ['upload'], accept: ['image'] }} onPick={vi.fn()} onClose={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(screen.getByRole('alert').textContent).toMatch(/isn't accepted/i);
    expect(screen.queryByText('Use this media')).toBeNull();
  });
});

describe('useMediaPicker', () => {
  it('resolves the promise with the picked selection and closes the modal', async () => {
    function Host({ onResult }: { onResult: (sel: unknown) => void }) {
      const { open, picker } = useMediaPicker({ sources: ['url'] });
      return (
        <>
          <button type="button" onClick={() => void open().then(onResult)}>open</button>
          {picker}
        </>
      );
    }
    const onResult = vi.fn();
    render(<Host onResult={onResult} />);

    fireEvent.click(screen.getByText('open'));
    const input = await waitFor(() => screen.getByPlaceholderText('https://…') as HTMLInputElement);
    fireEvent.change(input, { target: { value: 'https://x.com/b.jpg' } });
    fireEvent.click(screen.getByText('Preview'));
    fireEvent.click(screen.getByText('Use this media'));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ kind: 'url', url: 'https://x.com/b.jpg', source: 'url' }));
    // Modal unmounted after the pick.
    expect(screen.queryByPlaceholderText('https://…')).toBeNull();
  });

  it('resolves null when closed without a pick', async () => {
    function Host({ onResult }: { onResult: (sel: unknown) => void }) {
      const { open, picker } = useMediaPicker({});
      return (
        <>
          <button type="button" onClick={() => void open().then(onResult)}>open</button>
          {picker}
        </>
      );
    }
    const onResult = vi.fn();
    render(<Host onResult={onResult} />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Close media picker' })));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null));
  });
});
