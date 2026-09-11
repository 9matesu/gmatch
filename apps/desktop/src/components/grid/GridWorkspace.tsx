import { useEffect, useState } from 'react'
import { Maximize2, Minimize2, ImagePlus, Images } from 'lucide-react'
import GoonPanel from '../../ui/GoonPanel'
import ShopPanel from '../../ui/ShopPanel'
import StatsPanel from '../../ui/StatsPanel'
import OfflineModal from '../../ui/OfflineModal'
import { FeedTuneStep } from '../../firstRun/FeedTuneStep'
import { useToast } from '../Toast'
import { useGame } from '../../game/store'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { PanelResizer } from '../../ui/PanelResizer'
import IdleGalleryView from './IdleGalleryView'
import { playPress } from '../../utils/sounds'
import '../../ui/grid-animations.css'

const RIGHT_KEY = 'idle.right.collapsed.v1'

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
}: {
  idleFullscreen?: boolean
  onToggleFullscreen?: () => void
  onOpenSources?: () => void
}) {
  const ageVerified = useGame((s) => s.ageVerified)
  const setupComplete = useGame((s) => s.setupComplete)
  const toasts = useGame((s) => s.toasts)
  const { toast } = useToast()
  const right = useResizablePanel('dock')
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)
  const [galleryOpen, setGalleryOpen] = useState(false)
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
  // into the idle store so offline earnings + feed unlock the same way.
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

  // First feed pull once the player's own tags exist (was in old App.tsx).
  useEffect(() => {
    if (ageVerified && setupComplete) void useGame.getState().fetchFeed()
  }, [ageVerified, setupComplete])

  if (!setupComplete) {
    return (
      <div className="relative flex h-full min-h-0 items-center justify-center overflow-hidden bg-surface-canvas p-4 sm:p-8">
        <div className="glass-card flex max-h-full w-full max-w-2xl flex-col rounded-xl p-6 sm:p-8 space-y-5 overflow-y-auto styled-scrollbar">
          <div className="shrink-0 text-center">
            <h2 className="text-xl font-bold tracking-tight text-retro-fg">Pick your pleasure</h2>
            <p className="text-sm text-retro-muted mt-1.5">
              Tap {4} pills to tune your feed. Nothing is fetched before that.
            </p>
          </div>
          <FeedTuneStep onFinished={() => { /* fetchFeed fires off the setupComplete effect */ }} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas p-1 sm:p-2">
      <main className="relative flex min-h-0 flex-1 items-stretch gap-0 overflow-hidden">
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
                  className="p-1.5 rounded-lg border border-border-glass bg-surface-raised text-retro-muted hover:text-retro-fg hover:bg-surface-interactive transition-colors cursor-pointer"
                >
                  <Images className="w-3.5 h-3.5" />
                </button>
                {onOpenSources && (
                  <button
                    type="button"
                    onClick={() => { playPress(700); onOpenSources(); }}
                    title="Custom image sources — add your own URLs or folders"
                    aria-label="Custom image sources"
                    className="p-1.5 rounded-lg border border-border-glass bg-surface-raised text-retro-muted hover:text-retro-fg hover:bg-surface-interactive transition-colors cursor-pointer"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                  </button>
                )}
                {onToggleFullscreen && (
                  <button
                    type="button"
                    onClick={onToggleFullscreen}
                    title={idleFullscreen ? 'Exit fullscreen' : 'Play fullscreen'}
                    aria-label={idleFullscreen ? 'Exit fullscreen' : 'Play fullscreen'}
                    aria-pressed={idleFullscreen}
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${idleFullscreen
                      ? 'border-retro-accent bg-glass-w20 text-retro-accent'
                      : 'border-border-glass bg-surface-raised text-retro-muted hover:text-retro-fg hover:bg-surface-interactive'
                      }`}
                  >
                    {idleFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  title={collapsed ? 'Show tags & shop' : 'Maximize game stage (hide side column)'}
                  aria-label={collapsed ? 'Show tags & shop' : 'Maximize game stage'}
                  aria-pressed={collapsed}
                  className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${collapsed
                    ? 'border-retro-accent/60 bg-retro-accent/15 text-retro-fg'
                    : 'border-border-glass bg-surface-raised text-retro-muted hover:text-retro-fg hover:bg-surface-interactive'
                    }`}
                >
                  <span className="text-xs font-mono font-bold leading-none">
                    {collapsed ? '◧' : '⛶'}
                  </span>
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
            className="flex min-h-0 shrink-0 flex-col gap-2.5 overflow-y-auto pl-1 pr-1.5 pb-1 styled-scrollbar"
          >
            <StatsPanel />
            <ShopPanel />
          </aside>
        )}
      </main>

      {/* Keepsakes Gallery Modal */}
      {galleryOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Keepsakes Gallery"
          onClick={() => setGalleryOpen(false)}
        >
          <div
            className="glass-card relative flex h-full max-h-[90dvh] w-full max-w-4xl flex-col rounded-xl border border-border-glass bg-surface-canvas p-4 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
              <div className="flex items-center gap-2">
                <Images className="w-4 h-4 text-retro-accent" />
                <h3 className="text-sm font-bold text-retro-fg uppercase tracking-wider">
                  Drained Foes Gallery
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setGalleryOpen(false)}
                className="p-1 rounded-md text-retro-muted hover:text-retro-fg hover:bg-surface-interactive cursor-pointer"
                aria-label="Close gallery"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pt-2">
              <IdleGalleryView />
            </div>
          </div>
        </div>
      )}

      <OfflineModal />
    </div>
  )
}
