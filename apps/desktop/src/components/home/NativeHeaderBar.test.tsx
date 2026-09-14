// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NativeHeaderBar } from './NativeHeaderBar';

describe('NativeHeaderBar', () => {
  it('renders gMatch branding with back and forward navigator buttons to the left', () => {
    const { container } = render(<NativeHeaderBar />);

    expect(screen.getByText('gMatch')).toBeInTheDocument();
    const backBtn = screen.getByLabelText('Back');
    const fwdBtn = screen.getByLabelText('Forward');
    expect(backBtn).toBeInTheDocument();
    expect(fwdBtn).toBeInTheDocument();

    // Verify dot is removed (no retro-info square)
    expect(container.querySelector('.bg-retro-info')).toBeNull();
  });

  it('triggers onGoBack and onGoForward handlers or window.history when clicked', async () => {
    const onBack = vi.fn();
    const onForward = vi.fn();

    render(<NativeHeaderBar onGoBack={onBack} onGoForward={onForward} />);

    await userEvent.click(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByLabelText('Forward'));
    expect(onForward).toHaveBeenCalledTimes(1);
  });
});
