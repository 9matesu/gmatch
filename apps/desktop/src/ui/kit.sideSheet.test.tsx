// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SideSheet } from './kit'

/** The click-catcher that covers the page beside the sheet. */
function backdrop() {
  const el = document.querySelector('[data-side-sheet-backdrop]')
  if (!el) throw new Error('no side-sheet backdrop in the DOM')
  return el as HTMLElement
}

describe('SideSheet', () => {
  it('renders the title and its children', () => {
    render(
      <SideSheet open onClose={vi.fn()} title="Post · Alice">
        <button type="button">Inside</button>
      </SideSheet>,
    )
    expect(screen.getByRole('complementary', { name: 'Post · Alice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inside' })).toBeInTheDocument()
  })

  it('a click OUTSIDE the sheet closes it', async () => {
    // The user asked for this explicitly: "clicking out of it intentionally
    // should close it". The overlay used to carry `pointer-events-none`, so an
    // outside click could never reach the handler and the sheet stayed open
    // for the rest of the session.
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <SideSheet open onClose={onClose} title="Post">
        <button type="button">Inside</button>
      </SideSheet>,
    )
    await user.click(backdrop())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a click INSIDE the sheet does NOT close it', async () => {
    // Clicking the image, a button or the caption must not dismiss the
    // detail view — that is the whole point of "abrir ao lado".
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <SideSheet open onClose={onClose} title="Post">
        <button type="button">Inside</button>
      </SideSheet>,
    )
    await user.click(screen.getByRole('button', { name: 'Inside' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape closes it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <SideSheet open onClose={onClose} title="Post">
        <button type="button">Inside</button>
      </SideSheet>,
    )
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the Close button closes it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <SideSheet open onClose={onClose} title="Post">
        <button type="button">Inside</button>
      </SideSheet>,
    )
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
