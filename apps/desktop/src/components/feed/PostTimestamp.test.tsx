// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PostTimestamp } from './PostTimestamp'

/**
 * The timestamp is relative by default and absolute on hover or click.
 *
 * The absolute value must stay reachable without a pointer: it lives in the
 * title and the accessible name, so this is not a hover-only affordance. And
 * click has to latch, because touch has no hover at all.
 */

const ISO = '2026-09-20T15:28:19.867Z'

const mem = new Map<string, string>();

beforeEach(() => {
  // The relative form only lives for five weeks (utils/timeAgo returns a date
  // after that). Pin the clock so this suite never turns red because the
  // calendar moved: 4 days after ISO is the "4d" branch.
  vi.useFakeTimers({ now: new Date('2026-09-24T15:28:19.867Z') });
  mem.clear();
  // Node 22+ ships a global `localStorage` that throws unless
  // --localstorage-file is set, and it shadows jsdom's. Stub it the way
  // api.reconcile.test.ts does rather than relying on either real one.
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as Storage);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PostTimestamp', () => {
  // A 13-day-old ISO date lands on `timeAgo`'s "9mo"/"1y" branch rather than a
  // short token, so match the element by its accessible name (stable) and read
  // its text, instead of pattern-matching a shape that depends on the clock.
  const stamp = () => screen.getByLabelText(/^Posted /);

  it('shows relative time by default', () => {
    render(<PostTimestamp createdAt={ISO} />)
    const el = stamp()
    expect(el.textContent).not.toMatch(/\d{4}/)
  })

  it('switches to the absolute date on hover', () => {
    render(<PostTimestamp createdAt={ISO} />)
    const el = stamp()
    fireEvent.mouseEnter(el)
    expect(el.textContent).toMatch(/\d{4}/)
    fireEvent.mouseLeave(el)
    expect(el.textContent).not.toMatch(/\d{4}/)
  })

  it('latches the absolute date on click, so touch can read it', () => {
    render(<PostTimestamp createdAt={ISO} />)
    const el = stamp()
    fireEvent.click(el)
    expect(el.textContent).toMatch(/\d{4}/)
    // Still absolute with the pointer gone: the click persisted the choice.
    fireEvent.mouseLeave(el)
    expect(el.textContent).toMatch(/\d{4}/)
  })

  it('carries the absolute time for keyboard and screen-reader users', () => {
    render(<PostTimestamp createdAt={ISO} />)
    // A hover-only timestamp is invisible to these users, so the full value
    // must be in the accessible name regardless of hover state.
    expect(screen.getByLabelText(/^Posted /)).toBeInTheDocument()
  })

  it('remembers the choice across posts', () => {
    const { unmount } = render(<PostTimestamp createdAt={ISO} />)
    fireEvent.click(stamp())
    unmount()
    render(<PostTimestamp createdAt={ISO} />)
    expect(stamp().textContent).toMatch(/\d{4}/)
  })

  it('reports the toggle so a caller can react', () => {
    const onToggle = vi.fn()
    render(<PostTimestamp createdAt={ISO} onToggle={onToggle} />)
    fireEvent.click(stamp())
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('exposes a machine-readable datetime for the absolute value', () => {
    render(<PostTimestamp createdAt={ISO} />)
    expect(stamp()).toHaveAttribute('dateTime')
  })

  it('is already absolute once the post is older than five weeks', () => {
    vi.setSystemTime(new Date('2026-11-15T00:00:00Z'))
    render(<PostTimestamp createdAt={ISO} />)
    // timeAgo's contract: weeks up to <5, then the calendar date.
    expect(stamp().textContent).toMatch(/\d{4}/)
  })
})
