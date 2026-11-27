// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from './kit'

const tabs = [
  { id: 'tags', label: 'Tags' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'caps', label: 'Caps' },
]

describe('Tabs keyboard navigation', () => {
  it('arrow keys move focus AND select the tab, wrapping at the ends', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function Harness() {
      // Controlled like every real caller: the parent owns the selection.
      return <Tabs tabs={tabs} value="tags" onChange={onChange} />
    }
    render(<Harness />)
    const [first, second, third] = screen.getAllByRole('tab')

    first.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('gallery')
    expect(document.activeElement).toBe(second)

    second.focus()
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('tags')

    third.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('tags')
    expect(document.activeElement).toBe(first)
  })

  it('Home and End jump to the first and last tab', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} value="gallery" onChange={onChange} />)
    const [first, , last] = screen.getAllByRole('tab')

    last.focus()
    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('tags')
    expect(document.activeElement).toBe(first)

    first.focus()
    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('caps')
    expect(document.activeElement).toBe(last)
  })
})
