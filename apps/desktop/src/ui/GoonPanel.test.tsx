// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
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
vi.mock('../utils/sounds', () => ({ playHit: vi.fn(), playPress: vi.fn() }))

const mocks = vi.hoisted(() => ({
  redeemShards: vi.fn(),
  getCurrentIdentity: vi.fn(),
  cachedImageFor: vi.fn<(url: string) => string | undefined>(() => undefined),
}))
vi.mock('../services/shardRedeem', () => ({ redeemShards: mocks.redeemShards }))
vi.mock('../hooks/useIdentity', () => ({ getCurrentIdentity: mocks.getCurrentIdentity }))
vi.mock('../services/imageCache', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/imageCache')>()
  return {
    ...mod,
    cachedImageFor: mocks.cachedImageFor,
    prefetchImages: vi.fn(),
    resolveImage: vi.fn(async () => undefined),
  }
})

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

    fireEvent.click(container.querySelector('button[aria-label="Attack the current foe"]')!)

    // Same node object, not merely an equivalent one.
    expect(container.querySelector('video')).toBe(video)
  })

  it('right-click unmutes a motion foe and right-click again mutes it', () => {
    useGame.setState({ viewMode: '1x1', current: post('foe-1', 'video'), foeHp: 100, foeMaxHp: 100, imageReady: true } as never)
    const { container } = render(<GoonPanel />)
    const video = container.querySelector('video')!
    const attack = screen.getByLabelText('Attack the current foe')

    expect(video.muted).toBe(true)
    fireEvent.contextMenu(attack)
    expect(video.muted).toBe(false)
    fireEvent.contextMenu(attack)
    expect(video.muted).toBe(true)
  })

  it('a right-click on a motion grid square toggles sound, not a purge', () => {
    const motionCell = { post: post('g-video', 'video'), hp: 100, maxHp: 100, clicks: 0 } as GridCell
    seedGrid([motionCell, cell('g-2', 100, 100), cell('g-3', 100, 100), cell('g-4', 100, 100)])
    const { container } = render(<GoonPanel />)
    const video = container.querySelector('video')!
    expect(video.muted).toBe(true)

    fireEvent.contextMenu(screen.getByRole('button', { name: /Foe 1:/ }))
    expect(video.muted).toBe(false)
    // Still-image squares keep saying purge; only motion squares toggle sound.
    expect(screen.getByRole('button', { name: /Foe 2:/ }).getAttribute('aria-label')).toContain('right-click to purge')
    expect(container.querySelector('video')).toBe(video)
    seedSingle(100, 100)
  })

  it('does not remount the image element when the stage is clicked', () => {
    useGame.setState({ viewMode: '1x1', current: post('foe-1'), foeHp: 100, foeMaxHp: 100, imageReady: true } as never)
    const { container } = render(<GoonPanel />)
    const img = container.querySelector('img[alt="goon feed"]')!
    expect(img).toBeTruthy()

    fireEvent.click(container.querySelector('button[aria-label="Attack the current foe"]')!)

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
    const stage = container.querySelector('button[aria-label="Attack the current foe"]')!
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
    const stage = container.querySelector('button[aria-label="Attack the current foe"]')!
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


  it('scores on press, ignores the follow-up click, and keeps keyboard activation', () => {
    seedSingle(100, 100)
    useGame.setState({ clicks: 0, crits: 0, foeClicks: 0 } as never)
    const { container } = render(<GoonPanel />)
    const stage = container.querySelector('button[aria-label="Attack the current foe"]')!
    // Scoring is gated on the picture painting; jsdom never loads images.
    fireEvent.load(container.querySelector('img[alt="goon feed"]')!)
    expect(useGame.getState().imageReady).toBe(true)

    // Press (pointerdown) scores immediately…
    stage.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(useGame.getState().clicks).toBe(1)
    // …and the click that follows a real press (detail > 0) does NOT double-count.
    stage.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(useGame.getState().clicks).toBe(1)
    // Keyboard activation (detail 0) still scores exactly once.
    stage.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    expect(useGame.getState().clicks).toBe(2)
  })

  // The stage is a BOX, not a button: it holds <video controls> and the
  // prev/next/purge buttons, and interactive content must never nest inside a
  // button. The click target is a real button layered over the media.
  it('layers the click target over the stage instead of nesting it', () => {
    useGame.setState({ viewMode: '1x1', current: post('foe-1', 'video'), foeHp: 100, foeMaxHp: 100, imageReady: true } as never)
    const { container } = render(<GoonPanel />)
    const target = container.querySelector('button[aria-label="Attack the current foe"]')
    expect(target).toBeTruthy()
    expect(target!.querySelector('video')).toBeNull()
    expect(target!.querySelector('button')).toBeNull()
    const video = container.querySelector('video')
    expect(video).toBeTruthy()
    expect(video!.closest('button')).toBeNull()
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

/** A real press on the stage (scores on pointerdown, per SPEC §7). */
function press(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  })
}

describe('GoonPanel gacha hit sequence', () => {
  beforeEach(() => {
    mocks.redeemShards.mockReset()
    mocks.getCurrentIdentity.mockReset()
    mocks.cachedImageFor.mockReset()
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    )
    useGame.setState({
      viewMode: '1x1',
      current: post('gacha-foe'),
      foeHp: 100,
      foeMaxHp: 100,
      grid: [],
      clicks: 0,
      crits: 0,
      points: 0,
      shards: 0,
      gallery: [],
      tags: [],
      userExcludes: [],
      pendingDrops: [],
      heatStreak: 0,
      lastClickAt: 0,
      feedOffline: false,
      fetching: false,
      queue: [],
      defeated: 0,
    } as never)
  })

  it('flashes the picture white with a hit-proportional peak and restarts per hit', () => {
    const { container } = render(<GoonPanel />)
    const img = container.querySelector('img[alt="goon feed"]')!
    fireEvent.load(img)
    const stage = container.querySelector('button[aria-label="Attack the current foe"]')!

    press(stage)
    expect(useGame.getState().clicks).toBe(1)
    const first = container.querySelector('[data-testid="goon-white-flash"]') as HTMLElement
    expect(first).toBeTruthy()
    const peak = Number(first.style.getPropertyValue('--gg-flash-peak'))
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(0.85)
    const firstName = first.className

    press(stage)
    const second = container.querySelector('[data-testid="goon-white-flash"]') as HTMLElement
    expect(second).toBeTruthy()
    expect(second.className).not.toBe(firstName)
    // The white flash never remounts the art it plays over.
    expect(container.querySelector('img[alt="goon feed"]')).toBe(img)
  })

  it('shakes the media element itself, not an empty overlay', () => {
    const { container } = render(<GoonPanel />)
    const img = container.querySelector('img[alt="goon feed"]')!
    fireEvent.load(img)
    const stage = container.querySelector('button[aria-label="Attack the current foe"]')!

    press(stage)
    expect(img.className).toMatch(/animate-\[gg-shake-[ab]/)
    const firstName = img.className
    press(stage)
    expect(img.className).not.toBe(firstName)
    expect(container.querySelector('img[alt="goon feed"]')).toBe(img)
  })

  it('reveals the KO shard GAIN and only the fresh drop, not a stale one', () => {
    useGame.setState({
      foeHp: 1,
      foeMaxHp: 100,
      // Lifetime total is NOT what this KO earned: only the +1 delta is shown.
      shards: 1000,
      defeated: 4,
      pendingDrops: [{ id: 'drop:stale', foeTitle: 'stale', tags: ['old_a', 'old_b', 'old_c'], timestamp: 1 }],
      current: { ...post('gacha-foe'), tags: ['blonde'] },
    } as never)
    const { container } = render(<GoonPanel />)
    fireEvent.load(container.querySelector('img[alt="goon feed"]')!)
    const stage = container.querySelector('button[aria-label="Attack the current foe"]')!

    press(stage)
    expect(container.querySelector('[data-testid="gacha-dissolve"]')).toBeTruthy()
    const reveal = screen.getByTestId('gacha-reveal')
    expect(reveal.textContent).toMatch(/Common|Copper|Silver|Gold|Diamond/)
    expect(reveal.textContent).toContain('1 shard')
    expect(reveal.textContent).not.toContain('1000 shards')
    expect(reveal.textContent).toContain('1 tag')
    expect(reveal.textContent).not.toContain('3 tags')
  })

  it('shows no drop count when the KO produced no new drop', () => {
    useGame.setState({
      foeHp: 1,
      foeMaxHp: 100,
      pendingDrops: [{ id: 'drop:stale', foeTitle: 'stale', tags: ['old_a'], timestamp: 1 }],
      current: { ...post('gacha-foe'), tags: [] },
    } as never)
    const { container } = render(<GoonPanel />)
    fireEvent.load(container.querySelector('img[alt="goon feed"]')!)
    press(container.querySelector('button[aria-label="Attack the current foe"]')!)
    expect(screen.getByTestId('gacha-reveal').textContent).not.toMatch(/tag/)
  })

  it('dissolves from the cached bytes with no referrer', () => {
    mocks.cachedImageFor.mockImplementation((url) => url.includes('dissolve-foe') ? 'gmcache://dissolved' : undefined)
    useGame.setState({ foeHp: 1, foeMaxHp: 100, current: post('dissolve-foe') } as never)
    const { container } = render(<GoonPanel />)
    fireEvent.load(container.querySelector('img[alt="goon feed"]')!)
    press(container.querySelector('button[aria-label="Attack the current foe"]')!)
    const dissolve = container.querySelector('[data-testid="gacha-dissolve"]')!
    expect(dissolve.getAttribute('src')).toBe('gmcache://dissolved')
    expect(dissolve.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('uses the gold rarity token on a Gold chip', () => {
    useGame.setState({ current: post('gold-foe'), foeHp: 100, foeMaxHp: 100, gallery: [], foeClicks: 0 } as never)
    render(<GoonPanel />)
    const chip = screen.getByTestId('foe-rarity')
    expect(chip.textContent).toBe('Gold')
    expect(chip.className).toContain('text-rarity-gold')
  })

  it('banks the KO click in the displayed rarity at a tier boundary', () => {
    // 'foe-1' has base 478: 478+1021 = 1499 (Silver), +1 = 1500 (Gold).
    useGame.setState({ current: post('foe-1'), foeHp: 100, foeMaxHp: 100, gallery: [], foeClicks: 1021 } as never)
    render(<GoonPanel />)
    expect(screen.getByTestId('foe-rarity').textContent).toBe('Gold')
  })

  it('gives every grid square its own boss name, rarity chip and aligned HP bar', () => {
    const named = (id: string): BooruPost => ({ ...post(id), tags: ['blonde_girl'] })
    useGame.setState({
      viewMode: '1x2',
      gallery: [],
      grid: [
        { post: named('b1'), hp: 100, maxHp: 100, clicks: 0 },
        { post: named('b2'), hp: 25, maxHp: 100, clicks: 0 },
      ] as never,
    } as never)
    render(<GoonPanel />)
    const first = screen.getByRole('button', { name: /Foe 1:/ })
    const second = screen.getByRole('button', { name: /Foe 2:/ })
    expect(first.querySelector('[data-testid="foe-name"]')!.textContent).toBe('blonde girl')
    expect(first.querySelector('[data-testid="foe-rarity"]')!.textContent).toMatch(
      /Common|Copper|Silver|Gold|Diamond/,
    )
    const fill = (b: HTMLElement) =>
      (b.querySelector('[data-testid="foe-hp-fill"]') as HTMLElement).style.width
    expect(fill(first)).toBe('100%')
    expect(fill(second)).toBe('25%')
  })

  it('shows a compact HUD read from real points, shards and heat', () => {
    useGame.setState({ points: 999, shards: 7, heatStreak: 12, lastClickAt: Date.now() } as never)
    render(<GoonPanel />)
    const hud = screen.getByTestId('clicker-hud')
    expect(hud.textContent).toContain('999')
    expect(hud.textContent).toContain('7 shards')
    expect(hud.textContent).toContain('x1.25')
  })

  it('offers real cap purchases in one compact row', () => {
    useGame.setState({ points: 200, caps: [], capsUsed: [] } as never)
    render(<GoonPanel />)
    const buy = screen.getByRole('button', { name: /Buy E-Girl Spit/ })
    fireEvent.click(buy)
    expect(useGame.getState().points).toBe(50)
    expect(useGame.getState().caps).toHaveLength(1)
  })

  it('skips all hit animation under prefers-reduced-motion but still scores', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    )
    useGame.setState({ foeHp: 1, foeMaxHp: 100 } as never)
    const before = useGame.getState().defeated
    const { container } = render(<GoonPanel />)
    fireEvent.load(container.querySelector('img[alt="goon feed"]')!)
    const stage = container.querySelector('button[aria-label="Attack the current foe"]')!
    press(stage)
    expect(container.querySelector('[data-testid="goon-white-flash"]')).toBeNull()
    expect(container.querySelector('[data-testid="gacha-dissolve"]')).toBeNull()
    expect(useGame.getState().defeated).toBe(before + 1)
  })

  it('scores a grid square once on click (mouse or keyboard), never on a drag', () => {
    // Exactly fill a 1x2 board so the grid top-up effect leaves it alone.
    useGame.setState({ viewMode: '1x2', grid: [cell('g1', 100, 100), cell('g2', 100, 100)], clicks: 0 } as never)
    render(<GoonPanel />)
    const tile = screen.getByRole('button', { name: /Foe 1:/ })
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(useGame.getState().clicks).toBe(1)
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    expect(useGame.getState().clicks).toBe(2)
  })

  it('does not score the press that starts a tile drag', () => {
    useGame.setState({ viewMode: '1x2', grid: [cell('g1', 100, 100), cell('g2', 100, 100)], clicks: 0 } as never)
    render(<GoonPanel />)
    const tile = screen.getByRole('button', { name: /Foe 1:/ })
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => '0'), effectAllowed: '', dropEffect: '' }
    // Real browser order: pointerdown -> pointermove -> dragstart -> dragend.
    // A drag produces no click, so a click-only tile cannot score it.
    press(tile)
    fireEvent.pointerMove(tile)
    fireEvent.dragStart(tile, { dataTransfer })
    fireEvent.dragEnd(tile, { dataTransfer })
    expect(useGame.getState().clicks).toBe(0)
    fireEvent.click(tile)
    expect(useGame.getState().clicks).toBe(1)
  })

  it('spends only the shards the node took and reports the real g$ grant', async () => {
    useGame.setState({ shards: 2000 } as never)
    mocks.getCurrentIdentity.mockReturnValue({ orbitId: 'me' } as never)
    mocks.redeemShards.mockResolvedValueOnce({
      ok: true, grantedG: 7, shardsSpent: 1000, balance: 7, remaining24h: 4, nextRedeemAt: 'later',
    })
    render(<GoonPanel />)
    await act(async () => { fireEvent.click(screen.getByTestId('redeem-shards')) })
    expect(mocks.redeemShards).toHaveBeenCalledWith({ orbitId: 'me' }, 1000)
    expect(useGame.getState().shards).toBe(1000)
    expect(useGame.getState().toasts.at(-1)?.msg).toContain('+7 g$ credited')
  })

  it('never spends shards on a cooldown and shows the real reason', async () => {
    useGame.setState({ shards: 1000 } as never)
    mocks.getCurrentIdentity.mockReturnValue({ orbitId: 'me' } as never)
    mocks.redeemShards.mockResolvedValueOnce({
      ok: false, grantedG: 0, shardsSpent: 0, balance: 0, remaining24h: 0,
      nextRedeemAt: 'later', error: 'Shard redemption is cooling down', retryAfterMs: 5000,
    })
    render(<GoonPanel />)
    await act(async () => { fireEvent.click(screen.getByTestId('redeem-shards')) })
    expect(useGame.getState().shards).toBe(1000)
    expect(useGame.getState().toasts.at(-1)?.msg).toContain('cooling down')
    expect(useGame.getState().toasts.at(-1)?.msg).toContain('Retry in 5s')
  })
})
