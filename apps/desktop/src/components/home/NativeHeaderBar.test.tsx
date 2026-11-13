// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
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

  it('opens the post creator in one click from the navbar', async () => {
    const onCreatePost = vi.fn();
    render(<NativeHeaderBar onCreatePost={onCreatePost} />);

    await userEvent.click(screen.getByLabelText('Create a post'));
    expect(onCreatePost).toHaveBeenCalledTimes(1);
  });

  it('renders no post button without onCreatePost (tests / non-shell embeds)', () => {
    render(<NativeHeaderBar />);
    expect(screen.queryByLabelText('Create a post')).toBeNull();
  });

  it('pops the media picker bubble from the Post button on hover and hands the pick over', () => {
    vi.useFakeTimers();
    const onPickMedia = vi.fn();
    const onCreatePost = vi.fn();
    render(<NativeHeaderBar onCreatePost={onCreatePost} onPickMedia={onPickMedia} />);

    // Hover intent delay, then the bubble pops from the button.
    fireEvent.mouseEnter(screen.getByLabelText('Create a post').parentElement!);
    act(() => { vi.advanceTimersByTime(250); });

    expect(screen.getByRole('dialog', { name: 'Pick post media' })).toBeInTheDocument();

    // Leaving the button area (with its grace period) closes the bubble.
    fireEvent.mouseLeave(screen.getByLabelText('Create a post').parentElement!);
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole('dialog', { name: 'Pick post media' })).toBeNull();
    vi.useRealTimers();
  });

  it('clicking the Post button opens the creator directly and shuts the bubble', async () => {
    const onCreatePost = vi.fn();
    render(<NativeHeaderBar onCreatePost={onCreatePost} onPickMedia={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('Create a post'));
    expect(onCreatePost).toHaveBeenCalledTimes(1);
  });
});
