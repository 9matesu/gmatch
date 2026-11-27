// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { useStableCallback } from './useStableCallback'

describe('useStableCallback', () => {
  it('keeps one identity across renders', () => {
    const seen: Array<(...args: number[]) => number> = []
    function Probe({ value }: { value: number }) {
      const cb = useStableCallback((n: number) => n + value)
      seen.push(cb)
      return <button onClick={() => cb(1)}>{value}</button>
    }
    const { rerender } = render(<Probe value={1} />)
    rerender(<Probe value={2} />)
    rerender(<Probe value={3} />)
    expect(seen[0]).toBe(seen[1])
    expect(seen[1]).toBe(seen[2])
  })

  it('calls the LATEST closure, not the first one', () => {
    function Probe() {
      const [value, setValue] = useState(1)
      const cb = useStableCallback(() => value * 10)
      return (
        <button onClick={() => { setValue(value + 1); (window as any).__out = cb() }}>
          {value}
        </button>
      )
    }
    render(<Probe />)
    const button = screen.getByRole('button')
    fireEventClick(button)
    expect((window as any).__out).toBe(10)
    fireEventClick(button)
    expect((window as any).__out).toBe(20)
  })

  it('survives a prop that changes every render without re-creating', () => {
    const identities = new Set<unknown>()
    function Probe({ items }: { items: number[] }) {
      const cb = useStableCallback(() => items.length)
      identities.add(cb)
      return <span onClick={() => cb()}>{items.length}</span>
    }
    const { rerender } = render(<Probe items={[1]} />)
    rerender(<Probe items={[1, 2]} />)
    expect(identities.size).toBe(1)
    expect(screen.getByText('2')).toBeTruthy()
  })
})

function fireEventClick(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}