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

  it('taps four pills with no typing and starts', async () => {
    const onFinished = vi.fn();
    render(<FeedTuneStep onFinished={onFinished} />);

    // Pills-only: no textboxes anywhere on first run.
    expect(screen.queryByRole('textbox')).toBeNull();

    for (const name of ['milf', 'creampie', 'ahegao', 'doggystyle']) {
      fireEvent.click(screen.getByRole('button', { name: `+ ${name}` }));
    }

    const startButton = screen.getByRole('button', { name: /start/i });
    await waitFor(() => expect(startButton).toBeEnabled());

    await act(async () => {
      fireEvent.click(startButton);
    });

    expect(useGame.getState().setupComplete).toBe(true);
    expect(useGame.getState().tags.filter((t) => t.selected).map((t) => t.name)).toEqual([
      'milf',
      'creampie',
      'ahegao',
      'doggystyle',
    ]);
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it('tapping a chosen pill removes it and blocks start until refilled', async () => {
    const onFinished = vi.fn();
    render(<FeedTuneStep onFinished={onFinished} />);

    for (const name of ['milf', 'creampie', 'ahegao', 'doggystyle']) {
      fireEvent.click(screen.getByRole('button', { name: `+ ${name}` }));
    }
    // Remove one via the chosen slot.
    fireEvent.click(screen.getByRole('button', { name: 'Remove milf' }));

    const startButton = screen.getByRole('button', { name: /start/i });
    expect(startButton).toBeDisabled();
    expect(screen.getByText(/3\/4 picked/)).toBeInTheDocument();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('clashing one-tap exclude blocks start with a note', async () => {
    const onFinished = vi.fn();
    render(<FeedTuneStep onFinished={onFinished} />);

    // Pick 3 starters.
    for (const name of ['milf', 'creampie', 'ahegao']) {
      fireEvent.click(screen.getByRole('button', { name: `+ ${name}` }));
    }
    // Pick futanari as the 4th starter from the starter cloud.
    const starterBtn = screen.getAllByRole('button', { name: '+ futanari' })[0];
    fireEvent.click(starterBtn);

    // After picking futanari, it is removed from the starter cloud.
    // The remaining button '+ futanari' is the one-tap exclude chip.
    const excludeBtn = screen.getByRole('button', { name: '+ futanari' });
    fireEvent.click(excludeBtn);

    const startButton = screen.getByRole('button', { name: /start/i });
    await waitFor(() => expect(startButton).toBeEnabled());
    await act(async () => {
      fireEvent.click(startButton);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/would block a starter tag/);
    expect(onFinished).not.toHaveBeenCalled();
  });
});
