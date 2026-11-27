// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './kit'

/** A trigger that opens the dialog, so focus-return has a real opener. */
function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Modal title="Confirm" onClose={() => setOpen(false)}>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button">Confirm</button>
        </Modal>
      )}
    </>
  )
}

describe('Modal shell', () => {
  it('names the dialog by its title and renders the children', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('Escape closes it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal title="Confirm" onClose={onClose}>
        <button type="button">Cancel</button>
      </Modal>,
    )
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tab cycles inside the dialog instead of escaping to the page', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const focusable = screen.getByRole('dialog').querySelectorAll<HTMLButtonElement>('button')
    const last = focusable[focusable.length - 1]

    last.focus()
    await user.tab()
    expect(document.activeElement).toBe(focusable[0])
  })

  it('caps its height and scrolls so a tall dialog cannot push controls off-screen', () => {
    render(
      <Modal title="Tall" onClose={vi.fn()}>
        <button type="button">Cancel</button>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    // jsdom has no layout: pin the rule that keeps the centred dialog inside
    // a short viewport instead of letting it grow past the top of the window.
    expect(dialog.className).toContain('max-h-full')
    expect(dialog.className).toContain('overflow-y-auto')
  })

  it('stacks a newly opened modal above the older one and Escape closes only the top', async () => {
    const user = userEvent.setup()
    function StackHarness() {
      const [first, setFirst] = useState(true)
      const [second, setSecond] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setSecond(true)}>Open second</button>
          {first && <Modal title="First" onClose={() => setFirst(false)}><button type="button">first body</button></Modal>}
          {second && <Modal title="Second" onClose={() => setSecond(false)}><button type="button">second body</button></Modal>}
        </>
      )
    }
    render(<StackHarness />)
    await user.click(screen.getByRole('button', { name: 'Open second' }))
    const lower = screen.getByRole('dialog', { name: 'First' }).parentElement as HTMLElement
    const upper = screen.getByRole('dialog', { name: 'Second' }).parentElement as HTMLElement
    const priority = (el: HTMLElement) => Number(/\+ (\d+)\)/.exec(el.style.zIndex)?.[1] ?? 0)
    expect(priority(upper)).toBeGreaterThan(priority(lower))

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Second' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'First' })).toBeNull()
  })

  it('returns focus to the trigger on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(document.activeElement).toBe(trigger)
  })
})