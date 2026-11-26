// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

/**
 * The custody count lives in an in-memory map, so a surface must re-read it
 * when a NEW receipt lands. Without the listener the number would freeze on its
 * mount-time value and a peer's confirmation would never show.
 */
const state = vi.hoisted(() => ({ holders: new Map<string, number>() }))

vi.mock('../utils/p2pSwarm', () => ({
  DURABLE_REPLICATION_EVENT: 'orbit-durable-replication',
  durableCustodyHolders: (id: string) => state.holders.get(id) ?? 1,
}))

import { useDurableCustody } from './useDurableCustody'
import { DURABLE_REPLICATION_EVENT } from '../utils/p2pSwarm'

function Probe({ id }: { id?: string | null }) {
  return <span data-testid="holders">{useDurableCustody(id)}</span>
}

function emit(id: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent(DURABLE_REPLICATION_EVENT, { detail: { id } }))
  })
}

describe('useDurableCustody', () => {
  beforeEach(() => {
    state.holders.clear()
  })

  it('reads the current count for the object', () => {
    state.holders.set('a'.repeat(64), 3)
    render(<Probe id={'a'.repeat(64)} />)
    expect(screen.getByTestId('holders').textContent).toBe('3')
  })

  it('updates when a receipt for THIS object lands', () => {
    const id = 'b'.repeat(64)
    state.holders.set(id, 1)
    render(<Probe id={id} />)
    expect(screen.getByTestId('holders').textContent).toBe('1')

    state.holders.set(id, 2)
    emit(id)
    expect(screen.getByTestId('holders').textContent).toBe('2')
  })

  it('ignores a receipt for a different object', () => {
    const mine = 'c'.repeat(64)
    state.holders.set(mine, 1)
    render(<Probe id={mine} />)

    state.holders.set(mine, 4)
    emit('d'.repeat(64))
    expect(screen.getByTestId('holders').textContent).toBe('1')
  })

  it('reports zero with no object id', () => {
    state.holders.set('e'.repeat(64), 5)
    render(<Probe id={null} />)
    expect(screen.getByTestId('holders').textContent).toBe('0')
  })

  it('re-reads when the object changes', () => {
    const first = 'f'.repeat(64)
    const second = '0'.repeat(64)
    state.holders.set(first, 2)
    state.holders.set(second, 3)
    const { rerender } = render(<Probe id={first} />)
    expect(screen.getByTestId('holders').textContent).toBe('2')
    rerender(<Probe id={second} />)
    expect(screen.getByTestId('holders').textContent).toBe('3')
  })
})
