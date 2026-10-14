'use client'

import { X } from 'lucide-react'

export interface ChangelogModalProps {
  isOpen: boolean
  onClose: () => void
}

export const CURRENT_CHANGELOG_VERSION = '1.5.5'

/**
 * One entry per change, in the reader's words.
 *
 * This used to be four hard-coded cards, each with a coloured icon and a
 * paragraph of marketing copy that claimed things like "ensures screen-sharing
 * never turns black". Two problems: the prose was mostly reassurance rather
 * than information, and it was never updated. The body was still the 1.5.1 text
 * after 1.5.2 shipped, so the changelog described a superseded release.
 *
 * So: a flat list, one line each, saying what changed and nothing else. No
 * icons, no adjective that does no work. When you cut a release, replace the
 * list.
 */
const CHANGES: string[] = [
  'Command bar: removed horizontal scrollbar and optimized dock width and button spacing.',
  'Monochrome HUD: uncolored servers button and stripped arbitrary colored badges across the navigation dock and settings.',
  'Profile: follower and following counts now update live in real time directly on the profile tab.',
  'Visual uniformity: unified glass opacity and backdrop blur sliders across all tabs (clicker, chat, feed, gallery, and settings).',
  'Account & Security: streamlined cryptographic key display, backup export, and session logout controls to match design tokens.',
  'Accessibility: passed full WCAG 2.1 AA audit across all screens with zero high-severity violations.',
]

export function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`What's New in version ${CURRENT_CHANGELOG_VERSION}`}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 sm:p-6 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-border-glass bg-surface-canvas/95 backdrop-blur-xl shadow-2xl overflow-hidden text-left">
        <div className="flex items-center justify-between p-5 border-b border-border-glass/60 bg-surface-raised/40">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-retro-fg">What&apos;s New</h3>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-retro-accent/20 text-retro-accent border border-retro-accent/30">
              v{CURRENT_CHANGELOG_VERSION}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close changelog"
            className="p-1.5 rounded-lg border border-border-glass hover:text-retro-fg/40 text-retro-muted hover:text-white transition-colors cursor-pointer bg-surface-raised/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 styled-scrollbar text-xs leading-relaxed text-retro-body">
          <ul className="space-y-3 list-disc pl-4 marker:text-retro-muted">
            {CHANGES.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </div>

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
