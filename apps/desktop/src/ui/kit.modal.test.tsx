// @vitest-environment jsdom
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

  it('returns focus to the trigger on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(document.activeElement).toBe(trigger)
  })
})