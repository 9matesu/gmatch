// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GoonPanel from './GoonPanel'
import { useGame } from '../game/store'
import type { BooruPost, GridCell } from '../game/types'

vi.mock('../services/booru', () => ({
  searchPosts: vi.fn(async () => []),
  randomPosts: vi.fn(async () => []),
}))

vi.mock('./CachedImg', () => ({
  default: (p: { src: string; alt?: string }) => <img data-testid="cached-img" src={p.src} alt={p.alt ?? ''} />,
}))

vi.mock('../utils/sound', () => ({ playHit: vi.fn() }))

beforeEach(() => {
  // useReducedMotion reads matchMedia; jsdom ships none.
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
})

const post = (id: string, kind: BooruPost['kind'] = 'image'): BooruPost => ({
  id,
  kind,
  url: `https://cdn.test/${id}.${kind === 'video' ? 'mp4' : 'jpg'}`,
  preview: `https://cdn.test/${id}-p.jpg`,
  tags: ['ahegao'],
  rating: 'explicit',
})

/** Put the store in single-foe mode with a known foe. */
function seedSingle(hp: number, maxHp: number) {
  useGame.setState({
    viewMode: '1x1',
    current: post('foe-1'),
    foeHp: hp,
    foeMaxHp: maxHp,
    grid: [],
    imageReady: true,
  } as never)
}

function seedGrid(cells: GridCell[]) {
  useGame.setState({ viewMode: '2x2', grid: cells, current: post('foe-1'), imageReady: true } as never)
}

const cell = (id: string, hp: number, maxHp: number): GridCell =>
  ({ post: post(id), hp, maxHp, clicks: 0 }) as GridCell

describe('GoonPanel click feedback', () => {
  beforeEach(() => {
    useGame.setState({ viewMode: '1x1', current: post('foe-1'), foeHp: 100, foeMaxHp: 100, grid: [], imageReady: true } as never)
  })

  // THE BUG. The stage used to carry `key={shakeCell === null ? shakeKey : 0}`,
  // so every click unmounted the subtree holding the <img>/<video>: a video
  // restarted from 0 and a cached image flashed a blank frame. Assert the media
  // ELEMENT identity survives a click, which is what actually regressed.
  it('does not remount the video element when the stage is clicked', () => {
    useGame.setState({ viewMode: '1x1', current: post('foe-1', 'video'), foeHp: 100, foeMaxHp: 100, imageReady: true } as never)
    const { container } = render(<GoonPanel />)
    const video = container.querySelector('video')!
    expect(video).toBeTruthy()

    fireEvent.click(container.querySelector('[role="button"][aria-label="Attack the current foe"]')!)

    // Same node object, not merely an equivalent one.
    expect(container.querySelector('video')).toBe(video)
  })

  it('does not remount the image element when the stage is clicked', () => {
    useGame.setState({ viewMode: '1x1', current: post('foe-1'), foeHp: 100, foeMaxHp: 100, imageReady: true } as never)
    const { container } = render(<GoonPanel />)
    const img = container.querySelector('img[alt="goon feed"]')!
    expect(img).toBeTruthy()

    fireEvent.click(container.querySelector('[role="button"][aria-label="Attack the current foe"]')!)

    expect(container.querySelector('img[alt="goon feed"]')).toBe(img)
  })

  it('does not remount a grid tile media element when that tile is clicked', () => {
    seedGrid([cell('g1', 100, 100), cell('g2', 100, 100), cell('g3', 100, 100), cell('g4', 100, 100)])
    const { container } = render(<GoonPanel />)
    const tile = screen.getByRole('button', { name: /Foe 1:/ })
    const img = tile.querySelector('img')!

    fireEvent.click(tile)

    // The grid tile key is `${cell.post.id}:${i}` — no shake component. Clicking
    // the same tile repeatedly must keep the same DOM nodes.
    fireEvent.click(screen.getByRole('button', { name: /Foe 1:/ }))
    fireEvent.click(screen.getByRole('button', { name: /Foe 1:/ }))

    expect(screen.getByRole('button', { name: /Foe 1:/ }).querySelector('img')).toBe(img)
    expect(container).toBeTruthy()
  })

  // Progressive overlay: absent at full health, deepening as the foe is worn
  // down, so the stage shows "how close is this to dying" at a glance.
  it('shows no damage wash at full health and deepens it as HP falls', () => {
    seedSingle(100, 100)
    const { container, rerender } = render(<GoonPanel />)
    expect(container.querySelector('[data-testid="goon-hit-flash"]')).toBeNull()

    // The progressive wash is the sibling span that carries a radial-gradient
    // background AND an explicit inline opacity (the per-hit flash has no
    // inline opacity, it is driven purely by its CSS animation).
    const washOpacity = () => {
      const nodes = Array.from(container.querySelectorAll('span[aria-hidden="true"]')).filter((n) => {
        const el = n as HTMLElement
        return el.style.backgroundImage?.includes('radial-gradient') && el.style.opacity !== ''
      })
      return nodes.map((n) => Number((n as HTMLElement).style.opacity))
    }

    const at = (hp: number) => {
      useGame.setState({ foeHp: hp } as never)
      rerender(<GoonPanel />)
      return washOpacity()
    }

    const hurt = Math.max(...at(50))
    const nearly = Math.max(...at(5))
    const almost = Math.max(...at(1))
    expect(hurt).toBeGreaterThan(0)
    expect(nearly).toBeGreaterThan(hurt)
    expect(almost).toBeGreaterThan(nearly)
    // Never fully opaque: the media must stay readable underneath.
    expect(almost).toBeLessThanOrEqual(0.75)
  })

  it('emits a per-hit flash above the media and keeps it hit-restartable', () => {
    seedSingle(100, 100)
    const { container } = render(<GoonPanel />)
    const stage = container.querySelector('[role="button"][aria-label="Attack the current foe"]')!
    // Scoring is gated on the picture having painted; jsdom never loads
    // images, so fire the load the browser would.
    fireEvent.load(container.querySelector('img[alt="goon feed"]')!)

    fireEvent.click(stage)
    const first = container.querySelector('[data-testid="goon-hit-flash"]')
    expect(first).toBeTruthy()
    // a/b alternation: the animation-name must change between hits, which is
    // what restarts it without a remount.
    const firstName = first!.className
    fireEvent.click(stage)
    const second = container.querySelector('[data-testid="goon-hit-flash"]')
    expect(second).toBeTruthy()
    expect(second!.className).not.toBe(firstName)
    // And the media still never remounted.
    expect(container.querySelector('img[alt="goon feed"]')).toBe(
      container.querySelector('img[alt="goon feed"]'),
    )
  })

  it('does not score a click until the picture has painted', () => {
    // The regression this guards: imageReady used to be set the instant the
    // URL was assigned, so the first click or two of every picture scored
    // against a frame that had not been drawn yet.
    seedSingle(100, 100)
    // The store is module-level and shared across these tests, so start from a
    // known click count rather than whatever ran before.
    useGame.setState({ clicks: 0, crits: 0, foeClicks: 0 } as never)
    const { container } = render(<GoonPanel />)
    const stage = container.querySelector('[role="button"][aria-label="Attack the current foe"]')!
    expect(useGame.getState().imageReady).toBe(false)

    fireEvent.click(stage)
    expect(useGame.getState().clicks).toBe(0)
    // The Loading label is real UI, not dead markup.
    expect(screen.getByRole('status').textContent).toBe('Loading…')

    fireEvent.load(container.querySelector('img[alt="goon feed"]')!)
    expect(useGame.getState().imageReady).toBe(true)
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.click(stage)
    expect(useGame.getState().clicks).toBe(1)
  })

  it('applies a damage wash per grid tile based on that tile own HP', () => {
    seedGrid([cell('g1', 100, 100), cell('g2', 10, 100), cell('g3', 100, 100), cell('g4', 100, 100)])
    render(<GoonPanel />)
    const fresh = screen.getByRole('button', { name: /Foe 1:/ })
    const hurt = screen.getByRole('button', { name: /Foe 2:/ })
    const washIn = (b: HTMLElement) =>
      Array.from(b.querySelectorAll('span[aria-hidden="true"]'))
        .filter(
          (n) =>
            (n as HTMLElement).style.backgroundImage?.includes('radial-gradient') &&
            (n as HTMLElement).style.opacity !== '',
        )
        .map((n) => Number((n as HTMLElement).style.opacity))
    expect(washIn(fresh)).toHaveLength(0)
    expect(Math.max(0, ...washIn(hurt))).toBeGreaterThan(0.5)
  })
})
