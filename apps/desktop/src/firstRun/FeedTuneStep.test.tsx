// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedTuneStep } from './FeedTuneStep';
import { useGame } from '../game/store';

vi.mock('../services/booru', () => ({
  fetchPosts: vi.fn(async () => ({
    ok: true,
    posts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  })),
}));

describe('FeedTuneStep', () => {
  beforeEach(() => {
    useGame.setState({ setupComplete: false, tags: [], userExcludes: [] });
  });

  it('keeps the start action reachable and starts with four valid tags', async () => {
    const onFinished = vi.fn();
    render(<FeedTuneStep onFinished={onFinished} />);

    const values = ['starter_one', 'starter_two', 'starter_three', 'starter_four'];
    values.forEach((value, index) => {
      fireEvent.change(screen.getByLabelText(`Starter tag ${index + 1}`), { target: { value } });
    });

    const startButton = screen.getByRole('button', { name: /start/i });
    await waitFor(() => expect(startButton).toBeEnabled());

    await act(async () => {
      fireEvent.click(startButton);
    });

    expect(useGame.getState().setupComplete).toBe(true);
    expect(useGame.getState().tags.filter((t) => t.selected).map((t) => t.name)).toEqual(values);
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it('does not overflow the start action when many excludes are added', () => {
    const onFinished = vi.fn();
    render(<FeedTuneStep onFinished={onFinished} />);

    fireEvent.change(screen.getByLabelText('Extra excluded tags'), {
      target: { value: 'exclude_one, exclude_two, exclude_three, exclude_four' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    const action = screen.getByRole('button', { name: /start/i });
    const stickyParent = action.closest('.shrink-0');
    expect(stickyParent).not.toBeNull();
    expect(stickyParent?.classList.contains('glass-header')).toBe(true);
    expect(screen.getAllByText('×').length).toBe(4);
    expect(onFinished).not.toHaveBeenCalled();
  });
});
