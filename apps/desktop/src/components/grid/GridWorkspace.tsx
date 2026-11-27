import { useEffect, useState } from 'react'
import {
  ArrowsIn,
  ArrowsOut,
  FolderOpen,
  HardDrive,
  Images,
  MagnifyingGlass,
  SidebarSimple,
  X,
} from '@phosphor-icons/react'
import GoonPanel from '../../ui/GoonPanel'
import ShopPanel from '../../ui/ShopPanel'
import StatsPanel from '../../ui/StatsPanel'
import { useToast } from '../Toast'
import { useGame } from '../../game/store'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { PanelResizer } from '../../ui/PanelResizer'
import IdleGalleryView from './IdleGalleryView'
import TagBrowser from './TagBrowser'
import { ClickerCacheView } from './ClickerCacheView'
import { playPress } from '../../utils/sounds'
import '../../ui/grid-animations.css'

const RIGHT_KEY = 'idle.right.collapsed.v1'

/**
 * Escape closes the clicker's modals.
 *
 * These three are hand-rolled shells (a wide custom header the kit's `Modal`
 * does not have), so they need their own key handler — one hook, three
 * modals. Without it a modal could only be left with the mouse: a trap.
 */
function useEscapeClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(RIGHT_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * "Babecock · Idle" workspace (plan D2/D5): the gMatch idle game as a view
 * inside the gMatch shell. Panels are styled with Tailwind utilities
 * (src/ui/styles.ts); only the game's keyframes live in a stylesheet.
 */
export default function GridWorkspace({
  idleFullscreen = false,
  onToggleFullscreen,
  onOpenSources,
  onRepostImage,
  onAddToStory,
  onCreateCard,
  onSetWallpaper,
}: {
  idleFullscreen?: boolean
  onToggleFullscreen?: () => void
  onOpenSources?: () => void
  onRepostImage?: (media: { url: string; tags: string[]; name?: string; kind?: 'video' | 'image'; mimeType?: string }) => void
  onAddToStory?: (media: { url: string; tags: string[]; name?: string; kind?: 'video' | 'image'; mimeType?: string }) => void
  onCreateCard?: (media: { url: string; tags: string[]; name: string }) => void
  onSetWallpaper?: (url: string) => void
}) {
  const ageVerified = useGame((s) => s.ageVerified)
  const toasts = useGame((s) => s.toasts)
  const { toast } = useToast()
  const right = useResizablePanel('dock')
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [cacheOpen, setCacheOpen] = useState(false)
  useEscapeClose(galleryOpen, () => setGalleryOpen(false))
  useEscapeClose(browserOpen, () => setBrowserOpen(false))
  useEscapeClose(cacheOpen, () => setCacheOpen(false))
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(RIGHT_KEY, v ? '0' : '1')
      } catch {
        /* session-only */
      }
      return !v
    })
  }

  // The shell's AgeGateModal is the single 18+ gate (plan 5.5): mirror it
  // into the clicker store so the feed and the click game unlock together.
  useEffect(() => {
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('goonMatch_age_verified') === 'true' &&
      !useGame.getState().ageVerified
    ) {
      useGame.getState().verifyAge()
    }
  }, [])

  // Store toasts (KOs, purchases, unlocks) surface through the shell's toast
  // system — the legacy floating overlay + header bell are gone (plan 5.4).
  // Forwarded batches are cleared so the store queue never grows.
  useEffect(() => {
    if (toasts.length === 0) return
    for (const t of toasts) toast(t.msg, 'info')
    useGame.getState().clearToasts()
  }, [toasts, toast])

  // First feed pull once the age gate is passed. The clicker opens straight
  // into the game: tags are added in the Tags tab, and fetchFeed falls back to
  // the honest offline card until the player owns one.
  useEffect(() => {
    if (ageVerified) void useGame.getState().fetchFeed()
  }, [ageVerified])

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-transparent p-2 sm:p-3 pb-[var(--island-clearance)]">
      <section aria-label="Clicker workspace" className="relative flex min-h-0 flex-1 items-stretch gap-0 overflow-hidden">
        {/* Game Stage — expands, centers, left side */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden pr-1">
          <GoonPanel
            headerRight={
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { playPress(750); setGalleryOpen(true); }}
                  title="Keepsakes Gallery (drained foes)"
                  aria-label="Keepsakes Gallery"
                  className="h-7 px-2 rounded-md border border-edge bg-glass-w8 text-retro-muted hover:text-retro-fg hover:bg-glass-w10 hover:border-edge-strong transition cursor-pointer flex items-center gap-1.5 text-xs font-medium"
                >
                  <Images size={14} weight="bold" className="text-retro-accent" />
                  <span className="hidden sm:inline">Gallery</span>
                </button>
                <button
                  type="button"
                  onClick={() => { playPress(720); setBrowserOpen(true); }}
                  title="Browse images by owned tag"
                  aria-label="Browse by tag"
                  className="h-7 px-2 rounded-md border border-edge bg-glass-w8 text-retro-muted hover:text-retro-fg hover:bg-glass-w10 hover:border-edge-strong transition cursor-pointer flex items-center gap-1.5 text-xs font-medium"
                >
                  <MagnifyingGlass size={14} weight="bold" className="text-retro-accent" />
                  <span className="hidden sm:inline">Browse</span>
                </button>
                <button
                  type="button"
                  onClick={() => { playPress(740); setCacheOpen(true); }}
                  title="Picture cache — the pictures you already saw, ready to save"
                  aria-label="Picture cache"
                  className="h-7 px-2 rounded-md border border-edge bg-glass-w8 text-retro-muted hover:text-retro-fg hover:bg-glass-w10 hover:border-edge-strong transition cursor-pointer flex items-center gap-1.5 text-xs font-medium"
                >
                  <HardDrive size={14} weight="bold" className="text-retro-accent" />
                  <span className="hidden sm:inline">Cache</span>
                </button>
                {onOpenSources && (
                  <button
                    type="button"
                    onClick={() => { playPress(700); onOpenSources(); }}
                    title="Custom image sources: add your own URLs or folders"
                    aria-label="Custom image sources"
                    className="h-7 px-2 rounded-md border border-edge bg-glass-w8 text-retro-muted hover:text-retro-fg hover:bg-glass-w10 hover:border-edge-strong transition cursor-pointer flex items-center gap-1.5 text-xs font-medium"
                  >
                    <FolderOpen size={14} weight="bold" />
                    <span className="hidden sm:inline">Sources</span>
                  </button>
                )}
                {onToggleFullscreen && (
                  <button
                    type="button"
                    onClick={onToggleFullscreen}
                    title={idleFullscreen ? 'Exit fullscreen' : 'Play fullscreen'}
                    aria-label={idleFullscreen ? 'Exit fullscreen' : 'Play fullscreen'}
                    aria-pressed={idleFullscreen}
                    className={`h-7 w-7 rounded-md border transition cursor-pointer flex items-center justify-center ${idleFullscreen
                      ? 'border-retro-accent/60 bg-retro-accent/20 text-retro-accent'
                      : 'border-edge bg-glass-w8 text-retro-muted hover:text-retro-fg hover:bg-glass-w10 hover:border-edge-strong'
                      }`}
                  >
                    {idleFullscreen ? <ArrowsIn size={14} weight="bold" /> : <ArrowsOut size={14} weight="bold" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  title={collapsed ? 'Show tags & shop' : 'Maximize game stage (hide side column)'}
                  aria-label={collapsed ? 'Show tags & shop' : 'Maximize game stage'}
                  aria-pressed={collapsed}
                  className={`h-7 w-7 rounded-md border transition cursor-pointer flex items-center justify-center ${collapsed
                    ? 'border-retro-accent/60 bg-retro-accent/20 text-retro-accent'
                    : 'border-edge bg-glass-w8 text-retro-muted hover:text-retro-fg hover:bg-glass-w10 hover:border-edge-strong'
                    }`}
                >
                  <SidebarSimple size={14} weight={collapsed ? 'fill' : 'bold'} />
                </button>
              </div>
            }
          />
        </div>

        {/* Resizer Handle between Stage and Right Column */}
        {!collapsed && (
          <PanelResizer
            side="left"
            label="Resize tags and stats column"
            onDelta={right.dragBy}
          />
        )}

        {/* Right Column: Tags, Stats, Shop, with margin so it never crowds edges */}
        {!collapsed && (
          <aside
            style={{ width: right.width }}
            className="flex min-h-0 shrink-0 flex-col gap-2 overflow-y-auto pl-1 pr-1.5 pb-1 styled-scrollbar"
          >
            <StatsPanel />
            <ShopPanel />
          </aside>
        )}
      </section>

      {/* Keepsakes Gallery Modal */}
      {galleryOpen && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/70 p-3 sm:p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Keepsakes Gallery"
          onClick={() => setGalleryOpen(false)}
        >
          <div
            className="relative flex h-full max-h-[90dvh] w-full max-w-4xl flex-col rounded-xl border border-edge bg-retro-panel p-5 shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-edge">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-retro-accent/15 text-retro-accent border border-retro-accent/30">
                  <Images size={16} weight="bold" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-retro-fg tracking-wide ">
                    Drained Foes Gallery
                  </h3>
                  <p className="text-xs text-retro-fg/40">Collected keepsake archive & cards</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGalleryOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-edge bg-glass-w5 text-retro-muted hover:text-retro-fg hover:bg-glass-w10 hover:border-edge-strong transition cursor-pointer"
                aria-label="Close gallery"
              >
                <X size={14} weight="bold" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pt-3 styled-scrollbar">
              <IdleGalleryView
                onRepostImage={onRepostImage}
                onAddToStory={onAddToStory}
                onCreateCard={onCreateCard}
                onSetWallpaper={onSetWallpaper}
              />
            </div>
          </div>
        </div>
      )}

      {/* Tag Browser Modal */}
      {browserOpen && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/70 p-3 sm:p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Browse by tag"
          onClick={() => setBrowserOpen(false)}
        >
          <div
            className="relative flex h-full max-h-[90dvh] w-full max-w-4xl flex-col rounded-xl border border-edge bg-retro-panel p-5 shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-edge">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-retro-accent/15 text-retro-accent border border-retro-accent/30">
                  <MagnifyingGlass size={16} weight="bold" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-retro-fg tracking-wide ">
                    Tag Browser
                  </h3>
                  <p className="text-xs text-retro-fg/40">Browse live images by your owned tags</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBrowserOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-edge bg-glass-w5 text-retro-muted hover:text-retro-fg hover:bg-glass-w10 hover:border-edge-strong transition cursor-pointer"
                aria-label="Close tag browser"
              >
                <X size={14} weight="bold" />
              </button>
            </div>
            <TagBrowser />
          </div>
        </div>
      )}

      {/* Picture Cache Modal */}
      {cacheOpen && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/70 p-3 sm:p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Picture cache"
          onClick={() => setCacheOpen(false)}
        >
          <div
            className="relative flex h-full max-h-[90dvh] w-full max-w-4xl flex-col rounded-xl border border-edge bg-retro-panel p-5 shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-edge">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-retro-accent/15 text-retro-accent border border-retro-accent/30">
                  <HardDrive size={16} weight="bold" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-retro-fg tracking-wide ">
                    Picture Cache
                  </h3>
                  <p className="text-xs text-retro-fg/40">Every picture you already saw, kept on disk</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCacheOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-edge bg-glass-w5 text-retro-muted hover:text-retro-fg hover:bg-glass-w10 hover:border-edge-strong transition cursor-pointer"
                aria-label="Close picture cache"
              >
                <X size={14} weight="bold" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pt-3 styled-scrollbar">
              <ClickerCacheView toast={toast} />
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
