'use client'

import { Sparkles, Film, MessageSquare, ShieldCheck, Zap, X } from 'lucide-react'

export interface ChangelogModalProps {
  isOpen: boolean
  onClose: () => void
}

export const CURRENT_CHANGELOG_VERSION = '1.5.2'

export function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="What's New in version 1.5.2"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 sm:p-6 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-border-glass bg-surface-canvas/95 backdrop-blur-xl shadow-2xl overflow-hidden text-left">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border-glass/60 bg-surface-raised/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-retro-accent/20 border border-retro-accent/40 flex items-center justify-center text-retro-accent">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-retro-fg">What&apos;s New</h3>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-retro-accent/20 text-retro-accent border border-retro-accent/30">
                  v{CURRENT_CHANGELOG_VERSION}
                </span>
              </div>
              <p className="text-[11px] text-retro-muted">Recent updates, improvements, and fixes</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close changelog"
            className="p-1.5 rounded-lg border border-border-glass hover:border-retro-fg/40 text-retro-muted hover:text-white transition-colors cursor-pointer bg-surface-raised/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 styled-scrollbar text-xs leading-relaxed text-retro-body">
          {/* Watch Party item */}
          <div className="p-3.5 rounded-xl border border-border-glass/50 bg-surface-raised/20 space-y-1.5">
            <div className="flex items-center gap-2 text-retro-fg font-semibold">
              <Film className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Watch Party Theater &amp; Gallery</span>
            </div>
            <p className="text-retro-muted text-[11px]">
              Enjoy a dedicated 16:9 cinema gallery with live video miniatures and member indicators. Rooms remain permanently accessible in the directory even with 0 members. Unthrottled background playback ensures screen-sharing on Discord, Teams, or Meet never turns black when you switch windows.
            </p>
          </div>

          {/* Adaptive Chat item */}
          <div className="p-3.5 rounded-xl border border-border-glass/50 bg-surface-raised/20 space-y-1.5">
            <div className="flex items-center gap-2 text-retro-fg font-semibold">
              <MessageSquare className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Adaptive Chat Bubbles &amp; Inputs</span>
            </div>
            <p className="text-retro-muted text-[11px]">
              Chat message bubbles now naturally hug the size of their text without stretching across the entire window. The chat input dynamically expands vertically for long or multi-line messages.
            </p>
          </div>

          {/* Media Reliability & Story Timer item */}
          <div className="p-3.5 rounded-xl border border-border-glass/50 bg-surface-raised/20 space-y-1.5">
            <div className="flex items-center gap-2 text-retro-fg font-semibold">
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Media Reliability &amp; Story Buffer Hold</span>
            </div>
            <p className="text-retro-muted text-[11px]">
              Fast-fail timeouts identify missing or unresolvable swarm media within seconds, cleanly collapsing dead items so they take up zero space. Stories now hold their 5-second timer while video/image media is loading so you never miss content during buffering.
            </p>
          </div>

          {/* Server Browser item */}
          <div className="p-3.5 rounded-xl border border-border-glass/50 bg-surface-raised/20 space-y-1.5">
            <div className="flex items-center gap-2 text-retro-fg font-semibold">
              <ShieldCheck className="w-4 h-4 text-rose-400 shrink-0" />
              <span>First-Launch Server Browser</span>
            </div>
            <p className="text-retro-muted text-[11px]">
              New and onboarding users enjoy the same synchronized server browser, clean player metrics, and one-click node switching.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border-glass/60 bg-surface-raised/40 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-retro-accent hover:bg-retro-accent-hover text-black font-semibold text-xs transition-all shadow-md active:scale-95 cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
