// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TourDock } from './TourDock';
import type { TourState, TourStep } from '../../firstRun/tourState';

vi.mock('../../utils/sounds', () => ({ playPress: vi.fn() }));

const steps: TourStep[] = [
  { id: 'a', title: 'First', text: 'Text one.', view: 'feed' },
  { id: 'b', title: 'Second', text: 'Text two.', view: 'games', gamesTab: 'idle' },
];

const active: TourState = { version: 1, index: 0, status: 'active' };

describe('TourDock', () => {
  it('shows step 1 of N with title and text', () => {
    render(<TourDock steps={steps} state={active} onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('Show me calls onNext, Skip calls onSkip, Back disabled at step 0', () => {
    const onNext = vi.fn(); const onSkip = vi.fn(); const onBack = vi.fn();
    render(<TourDock steps={steps} state={active} onNext={onNext} onBack={onBack} onSkip={onSkip} />);
    expect(screen.getByRole('button', { name: /back/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /show me/i }));
    expect(onNext).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('last step shows Done instead of Show me', () => {
    const onNext = vi.fn();
    render(<TourDock steps={steps} state={{ ...active, index: 1 }} onNext={onNext} onBack={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('pointer step (view null) says Next, not Show me', () => {
    render(
      <TourDock
        steps={[{ id: 'p', title: 'Settings', text: 'Press ? for help.', view: null }]}
        state={{ version: 1, index: 0, status: 'active' }}
        onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()}
      />,
    );
    // single step = last, so it reads Done here; verify the non-last branch below
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
  });

  it('middle pointer step shows Next', () => {
    render(
      <TourDock
        steps={[...steps, { id: 'p', title: 'Pointer', text: 'Look over there.', view: null }, { id: 'q', title: 'Q', text: 'Another step.', view: null }]}
        state={{ version: 1, index: 2, status: 'active' }}
        onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()}
      />,
    );
    // index 2 of 4 -> not last, view null -> "Next"
    expect(screen.getByRole('button', { name: /^next$/i })).toBeInTheDocument();
  });
});
