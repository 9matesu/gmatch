// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HelpModal } from './HelpModal'
import { HELP_TOPICS } from '../help/helpContent'

/**
 * The card game had no explanation anywhere in the app, and the help modal
 * itself was only reachable by keyboard. These tests cover both: that the
 * guides exist, and that a person can actually find and close them.
 */

afterEach(() => vi.restoreAllMocks())

const tab = (name: string) => screen.getByRole('button', { name: new RegExp(name, 'i') })

describe('HelpModal — discoverability', () => {
  it('closes on Escape', () => {
    // Every other modal in the app has this. Help was opened with "?" and then
    // had to be closed by finding the X, which is a keyboard trap.
    const onClose = vi.fn()
    render(<HelpModal onClose={onClose} />)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('is a labelled dialog, not a bare div', () => {
    render(<HelpModal onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Help')
  })

  it('the close button has an accessible name', () => {
    render(<HelpModal onClose={vi.fn()} />)
    expect(screen.getByLabelText('Close help')).toBeDefined()
  })

  it('the original tabs are still there', () => {
    render(<HelpModal onClose={vi.fn()} />)
    for (const name of ['Getting Started', 'Sending', 'Network', 'Privacy', 'Shortcuts']) {
      expect(tab(name), name).toBeDefined()
    }
  })
})

describe('HelpModal — card duel guide', () => {
  it('has a Card Duels guide', () => {
    render(<HelpModal onClose={vi.fn()} />)
    // Reachable by its short tab label, and headed with the full title.
    fireEvent.click(tab('Duels'))
    expect(document.body.textContent || '').toContain('Card Duels')
  })

  it('explains the three decisions with their real numbers', () => {
    render(<HelpModal onClose={vi.fn()} />)
    fireEvent.click(tab('Duels'))
    const text = document.body.textContent || ''
    // The vocabulary the UI actually uses, with the actual economy values.
    // A player who cannot see why a Boost is worth it will think it is a bug.
    expect(text).toContain('Conviction Boost')
    expect(text).toContain('+25')
    expect(text).toContain('Reject')
    expect(text).toContain('Like')
  })

  it('states the deck requirement, which is the most common dead end', () => {
    render(<HelpModal onClose={vi.fn()} />)
    fireEvent.click(tab('Duels'))
    const text = document.body.textContent || ''
    expect(text).toMatch(/five cards|5 cards/i)
    expect(text).toMatch(/Set as Active|active deck/i)
  })

  it('documents the full rarity ladder with thresholds', () => {
    render(<HelpModal onClose={vi.fn()} />)
    fireEvent.click(tab('Duels'))
    const text = document.body.textContent || ''
    for (const tier of ['Common', 'Copper', 'Silver', 'Gold', 'Diamond']) {
      expect(text, tier).toContain(tier)
    }
  })

  it('explains the payouts and the League ladder', () => {
    render(<HelpModal onClose={vi.fn()} />)
    fireEvent.click(tab('Duels'))
    const text = document.body.textContent || ''
    expect(text).toContain('League Points')
    expect(text).toMatch(/Mythic|Legendary/)
  })
})

describe('HelpModal — every feature has a guide', () => {
  it('every content topic is reachable as a tab', () => {
    render(<HelpModal onClose={vi.fn()} />)
    for (const topic of HELP_TOPICS) {
      // By the tab label the CONTENT declares — the point of the test is that
      // the tab list is generated from the content and cannot fall behind it.
      expect(tab(topic.tabLabel), topic.id).toBeDefined()
    }
  })

  it('every topic renders its sections without throwing', () => {
    render(<HelpModal onClose={vi.fn()} />)
    for (const topic of HELP_TOPICS) {
      fireEvent.click(tab(topic.tabLabel))
      for (const section of topic.sections) {
        expect(document.body.textContent || '', `${topic.id}/${section.heading}`).toContain(
          section.heading,
        )
      }
    }
  })

  it('no section is empty — a heading with no body teaches nothing', () => {
    for (const topic of HELP_TOPICS) {
      for (const section of topic.sections) {
        const hasContent = Boolean(section.body || section.bullets?.length || section.callout)
        expect(hasContent, `${topic.id}/${section.heading}`).toBe(true)
      }
    }
  })

  it('every topic has a blurb for the contents list', () => {
    for (const topic of HELP_TOPICS) {
      expect(topic.blurb.trim().length, topic.id).toBeGreaterThan(0)
    }
  })

  it('every topic has a tab label, and it is short enough to fit the strip', () => {
    // Twelve tabs share one scrollable row. A long label pushes the Privacy
    // and Shortcuts tabs off the end on a narrow window.
    for (const topic of HELP_TOPICS) {
      expect(topic.tabLabel.trim().length, topic.id).toBeGreaterThan(0)
      expect(topic.tabLabel.length, topic.id).toBeLessThanOrEqual(12)
    }
  })

  it('topic ids are unique (they are React keys and tab ids)', () => {
    const ids = HELP_TOPICS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
