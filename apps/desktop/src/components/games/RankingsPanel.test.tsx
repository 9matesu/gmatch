// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { User } from '@orbit/shared'
import { RankingsPanel } from './RankingsPanel'

vi.mock('../Avatar', () => ({
  Avatar: ({ id }: { id: string }) => <span data-testid={`avatar-${id}`} />,
}))

const mk = (id: string, over: Partial<User> = {}): User =>
  ({
    id,
    publicKey: 'pk',
    createdAt: '2026-01-01T00:00:00.000Z',
    display_name: id.toUpperCase(),
    online: true,
    gacha_items_collected: 0,
    matches_won: 0,
    matches_lost: 0,
    reputation: 0,
    ...over,
  }) as User

/** Board rows are the buttons whose name ends in the board's score unit. */
const rows = (unit: RegExp) => screen.getAllByRole('button', { name: unit })
const rowText = () => rows(/finds|wins|pts/).map((el) => el.textContent || '')

const setup = (users: User[], onSelectUser = vi.fn(), currentUserId?: string) => {
  render(<RankingsPanel users={users} onSelectUser={onSelectUser} currentUserId={currentUserId} />)
  return onSelectUser
}

describe('RankingsPanel', () => {
  const roster = [
    mk('a', { gacha_items_collected: 10, reputation: 5 }),
    mk('b', { gacha_items_collected: 30, reputation: 50 }),
    mk('c', { gacha_items_collected: 20, reputation: 500 }),
    mk('d', { gacha_items_collected: 0, online: false, reputation: 999 }),
  ]

  it('orders the default board by collection finds and drops zero-score rows', () => {
    setup(roster)
    const text = rowText()
    expect(text[0]).toContain('B')
    expect(text[1]).toContain('C')
    expect(text[2]).toContain('A')
    // 'd' has 0 finds: it must not appear at all, not even at #4.
    expect(text.join(' ')).not.toContain('D')
  })

  // Regression: the board used to rank on `balance`, which the server only
  // returns for the caller, so it was empty for every other player.
  it('never ranks on wallet balance (balances stay private to their owner)', () => {
    setup([
      mk('a', { gacha_items_collected: 10, balance: 999_999 }),
      mk('b', { gacha_items_collected: 30, balance: 0 }),
    ])
    expect(rowText()[0]).toContain('B')
    expect(screen.queryByText(/999/)).toBeNull()
  })

  // Regression: rank was `idx + 1` on the FILTERED list, so searching or
  // toggling "Online only" restarted the numbering at #1.
  it('keeps ranks stable when a search filter is applied', () => {
    setup(roster)
    const rankOf = (row: HTMLElement) => within(row).queryByRole('img')?.getAttribute('aria-label')
    const before = rows(/finds/).map(rankOf)

    fireEvent.change(screen.getByLabelText('Search players'), { target: { value: 'A' } })
    const after = rows(/finds/)
    expect(after).toHaveLength(1)
    expect(after[0].textContent).toContain('A')
    // Still the board-wide position (#3), not a fresh #1.
    expect(rankOf(after[0])).toBe('Rank 3')
    expect(before).toEqual(['Rank 1', 'Rank 2', 'Rank 3'])
  })

  it('keeps ranks stable when "Online only" hides a higher scorer', () => {
    setup([
      mk('a', { gacha_items_collected: 40, online: false }),
      mk('b', { gacha_items_collected: 30, online: true }),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Online only' }))
    const row = rows(/finds/)[0]
    expect(row.textContent).toContain('B')
    // 'a' is still #1 overall, so 'b' keeps the #2 medal even though 'a' is
    // filtered out of the view.
    expect(within(row).getByRole('img', { name: 'Rank 2' })).toBeTruthy()
  })

  it('shows your own rank against the full board', () => {
    setup(roster, vi.fn(), 'b')
    expect(screen.getByTestId('rankings-my-rank').textContent).toContain('#1')
    expect(screen.getByTestId('rankings-my-rank').textContent).toContain('of 3')
  })

  it('hides your own rank when you have no score on the board', () => {
    setup(roster, vi.fn(), 'd')
    expect(screen.queryByTestId('rankings-my-rank')).toBeNull()
  })

  // Regression: only #1 got an icon; #2 and #3 rendered as muted text identical
  // to #4, so the top-three medals looked missing.
  it('gives the top three a medal and the rest a #n', () => {
    setup([
      ...roster,
      mk('e', { gacha_items_collected: 5 }),
      mk('f', { gacha_items_collected: 4 }),
    ])
    expect(screen.getAllByRole('img', { name: /^Rank [123]$/ })).toHaveLength(3)
    expect(screen.getAllByRole('img', { name: /^Rank [123]$/ }).map((el) => el.getAttribute('aria-label')))
      .toEqual(['Rank 1', 'Rank 2', 'Rank 3'])
    // #4 and below fall back to text.
    const all = rows(/finds/)
    expect(within(all[3]).queryByRole('img')).toBeNull()
    expect(all[3].textContent).toContain('#4')
  })

  it('renders the duel board with a real W/L and a duel count', () => {
    setup([
      mk('a', { matches_won: 4, matches_lost: 2 }),
      mk('b', { matches_won: 1, matches_lost: 0, matches_total: 9 }),
    ])
    fireEvent.click(screen.getByRole('button', { name: /Card Duel/i }))
    const arena = rows(/wins?/)
    expect(arena[0].textContent).toContain('4 wins')
    expect(arena[0].textContent).toContain('6 duels')
    expect(arena[0].textContent).toContain('4W 2L')
    // matches_total is a mutual-LIKE count, not duels: it must not leak into
    // the duel count.
    expect(arena[1].textContent).toContain('1 duel')
    expect(arena[1].textContent).not.toContain('9 duel')
  })

  it('ranks the social board by reputation, and by today with the toggle', () => {
    setup([
      mk('a', { reputation: 5, daily_score: 900 }),
      mk('b', { reputation: 50, daily_score: 1 }),
    ])
    fireEvent.click(screen.getByRole('button', { name: /Social/i }))
    expect(rowText()[0]).toContain('B') // 50 reputation
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(rowText()[0]).toContain('A') // 900 today
  })

  it('calls onSelectUser with the row id', () => {
    const onSelect = setup(roster)
    fireEvent.click(rows(/finds/)[0])
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('says nobody is on the board when no one has a score', () => {
    setup([mk('z', { gacha_items_collected: 0 })])
    expect(screen.getByText(/Nobody on this board yet/i)).toBeTruthy()
  })

  it('says the search found nobody on a populated board', () => {
    setup(roster)
    fireEvent.change(screen.getByLabelText('Search players'), { target: { value: 'zzz' } })
    expect(screen.getByText(/No players match your search/i)).toBeTruthy()
  })
})
