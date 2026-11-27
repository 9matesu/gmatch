// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextMenu } from './ContextMenu'

describe('shared ContextMenu', () => {
  it('is one data-driven menu for every surface, opened at the cursor', () => {
    render(
      <ContextMenu
        x={120}
        y={240}
        title="Actions"
        items={[
          { label: 'Copy', onSelect: vi.fn() },
          { label: 'Delete', danger: true, onSelect: vi.fn() },
          { label: 'Unavailable', disabled: true, onSelect: vi.fn() },
        ]}
        onDismiss={vi.fn()}
      />,
    )
    const menu = screen.getByRole('menu')
    expect(menu.style.left).toBe('120px')
    expect(menu.style.top).toBe('240px')
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
    expect((screen.getByRole('menuitem', { name: 'Unavailable' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls onSelect once and dismisses in the same tick', () => {
    const onSelect = vi.fn()
    const onDismiss = vi.fn()
    render(<ContextMenu x={10} y={10} items={[{ label: 'Like', onSelect }]} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Like' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('Escape and an outside pointer-down both close it', () => {
    const onDismiss = vi.fn()
    const { unmount } = render(<ContextMenu x={10} y={10} items={[{ label: 'Copy', onSelect: vi.fn() }]} onDismiss={onDismiss} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
    unmount()

    const onDismiss2 = vi.fn()
    render(<ContextMenu x={10} y={10} items={[{ label: 'Copy', onSelect: vi.fn() }]} onDismiss={onDismiss2} />)
    fireEvent.mouseDown(document.body)
    expect(onDismiss2).toHaveBeenCalledTimes(1)
  })
})
