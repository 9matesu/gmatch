// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BadgeShelf } from './BadgeShelf'

// Stats are injected through the hook, so the shelf is tested without the
// game store. The badge catalog and UI tokens stay REAL — this exercises the
// actual rarity mapping and token classes.
const h = vi.hoisted(() => ({
  stats: {
    clicks: 5000, crits: 120, gallerySaved: 60, capsUsed: 2, tagPurchases: 60,
    prestigeCount: 6, totalShardsEarned: 120, idleShardsEarned: 12, kOs: 150, maxHeatStreak: 55,
  },
}))

vi.mock('../../game/playerStats', () => ({ usePlayerStats: () => h.stats }))

const FULL = {
  clicks: 5000, crits: 120, gallerySaved: 60, capsUsed: 2, tagPurchases: 60,
  prestigeCount: 6, totalShardsEarned: 120, idleShardsEarned: 12, kOs: 150, maxHeatStreak: 55,
}
const ZERO = {
  clicks: 0, crits: 0, gallerySaved: 0, capsUsed: 0, tagPurchases: 0,
  prestigeCount: 0, totalShardsEarned: 0, idleShardsEarned: 0, kOs: 0, maxHeatStreak: 0,
}

describe('BadgeShelf', () => {
  beforeEach(() => {
    h.stats = { ...FULL }
  })

  it('shows earned badges and hides locked ones while collapsed', () => {
    render(<BadgeShelf />)

    expect(screen.getByText('Badges')).toBeInTheDocument()
    expect(screen.getByText('Thousand Clicks')).toBeInTheDocument()
    expect(screen.queryByText('Legendary Slayer')).toBeNull()
    expect(screen.getByText('7 locked')).toBeInTheDocument()
  })

  it('expands to the full list including locked badges', () => {
    render(<BadgeShelf />)

    fireEvent.click(screen.getByLabelText('Expand badges'))

    expect(screen.getByText('Legendary Slayer')).toBeInTheDocument()
    expect(screen.getByLabelText('Collapse badges')).toBeInTheDocument()
  })

  it('renders an earned badge with its rarity token and the tile with surface tokens', () => {
    const { container } = render(<BadgeShelf />)

    expect(screen.getByText('Thousand Clicks').className).toContain('text-rarity-copper')
    expect((container.firstChild as HTMLElement).className).toContain('bg-surface-raised')
  })

  it('says so when nothing is earned yet', () => {
    h.stats = ZERO

    render(<BadgeShelf title="My Badges" />)

    expect(screen.getByText('My Badges')).toBeInTheDocument()
    expect(screen.getByText(/No badges yet/)).toBeInTheDocument()
  })
})
