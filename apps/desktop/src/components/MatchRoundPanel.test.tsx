// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MatchRoundPanel } from './MatchRoundPanel';

describe('MatchRoundPanel opponent avatar', () => {
  const baseMatch = {
    id: 'm1',
    phase: 'pick' as const,
    round_seq: 1,
    opponent: { id: 'opp-1', display_name: 'Nemesis', pfp_url: 'https://example.com/nemesis.jpg' },
    my_card: null,
    score_mine: 0,
    score_opponent: 0,
    matched: false,
    rounds_history: [],
    round_deadline_ms: Date.now() + 60000,
  } as any;

  it('renders opponent avatar image from match.opponent.pfp_url', () => {
    const { container } = render(
      <MatchRoundPanel
        match={baseMatch}
        players={[]}
        identity={null}
        myCards={[]}
        soundEnabled={false}
        onPick={vi.fn()}
        onDecide={vi.fn()}
        onQuit={vi.fn()}
      />
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/nemesis.jpg');
  });

  it('falls back to users list pfp_url and Avatar fallback when match.opponent.pfp_url is null', () => {
    const matchNoPfp = {
      ...baseMatch,
      opponent: { id: 'opp-2', display_name: 'Ghost', pfp_url: null },
    };
    const users = [
      {
        id: 'opp-2',
        display_name: 'Ghost',
        pfp_url: 'https://example.com/ghost.jpg',
      } as any,
    ];
    const { container } = render(
      <MatchRoundPanel
        match={matchNoPfp}
        players={[]}
        users={users}
        identity={null}
        myCards={[]}
        soundEnabled={false}
        onPick={vi.fn()}
        onDecide={vi.fn()}
        onQuit={vi.fn()}
      />
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/ghost.jpg');
  });
});
