// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChangelogModal, CURRENT_CHANGELOG_VERSION } from './ChangelogModal'

/**
 * The changelog was four hard-coded cards, each with a coloured icon and a
 * paragraph of copy, and it was never updated — the body was still the 1.5.1
 * text after 1.5.2 shipped. These lock the shape that makes it maintainable: a
 * discrete list whose contents can change every release.
 */
describe('ChangelogModal', () => {
  it('renders the changes as a discrete list, not prose cards', () => {
    render(<ChangelogModal isOpen onClose={() => {}} />)
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(3)
    // Each entry is one self-contained line, not a four-sentence paragraph.
    for (const item of items) {
      const text = item.textContent ?? ''
      expect(text.length).toBeGreaterThan(0)
      expect(text.length).toBeLessThan(200)
    }
  })

  it('has no decorative icons, only the close control', () => {
    const { container } = render(<ChangelogModal isOpen onClose={() => {}} />)
    // The feature icons (Film/MessageSquare/Zap/ShieldCheck/Sparkles) are gone.
    expect(container.querySelectorAll('svg').length).toBe(1)
    expect(screen.getByRole('button', { name: 'Close changelog' })).toBeTruthy()
  })

  it('keeps the dialog contract the app and e2e depend on', () => {
    render(<ChangelogModal isOpen onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: `What's New in version ${CURRENT_CHANGELOG_VERSION}` })
    expect(dialog).toBeTruthy()
    expect(screen.getByRole('heading', { name: "What's New" })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ChangelogModal isOpen={false} onClose={() => {}} />)
    expect(container.innerHTML).toBe('')
  })
})
