"use client";

// One presentational row for every entry in the Browser (Destinations, Hosted
// servers, the legacy/relay status rows), so the anatomy — identity first,
// infrastructure second — cannot drift between sections. Behaviour stays in
// ServersView: this file owns layout, the status vocabulary (Current /
// Connecting / Relay / Deprecated / unavailable) and the two format helpers the
// row needs. Rows carry exactly one action plus the contextual menu.
import { ChevronDown, Loader2, Lock, MoreVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import type { DirectoryServer } from './directoryMerge'
import { BTN, BTN_SMALL, MONO } from '../../ui/styles'

export interface WorldRowState {
  /** Status vocabulary: Current · Connecting · Relay · Deprecated · Unavailable. */
  label?: string
  tone?: 'online' | 'muted' | 'warning'
  /** Right-aligned figure, only when real numbers back it (never a placeholder). */
  counts?: string | null
  /** Secondary line: domain · listed 2h ago · description. Hidden when empty. */
  meta?: string
  /** null = status-only row with no primary action. */
  primary: string | null
  primaryDisabled?: boolean
  primaryHint?: string
  /** Leading relay glyph for "switch to my own server" rows. */
  primaryIcon?: ReactNode
  /** Read-only state chip for status-only rows (Transport, Unreachable...). */
  status?: string | null
}

const DOT: Record<NonNullable<WorldRowState['tone']>, string> = {
  online: 'bg-retro-online',
  muted: 'bg-retro-muted/40',
  warning: 'bg-retro-warning',
}

const LABEL: Record<NonNullable<WorldRowState['tone']>, string> = {
  online: 'text-retro-online',
  muted: 'text-retro-muted',
  warning: 'text-retro-warning',
}

export function formatDomain(hint?: string | null): string {
  if (!hint) return ''
  const bare = hint.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  // Addresses never reach the screen: only a hostname is shown, IPs stay hidden.
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(bare) || /^\[/.test(bare)) return ''
  return bare
}

export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return 'recently'
  const s = typeof iso === 'string' && !iso.endsWith('Z') && !iso.includes('+')
    ? (iso.includes('T') ? `${iso}Z` : `${iso.replace(' ', 'T')}Z`)
    : iso
  const t = new Date(s).getTime()
  if (isNaN(t) || t <= 0) return 'recently'
  const ms = Date.now() - t
  if (ms < 0 && ms >= -15_000) return 'just now'
  if (ms < 0) return 'recently'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function WorldRow({
  server,
  state,
  expanded,
  onToggleDetails,
  menuOpen,
  onMenuToggle,
  onPrimary,
  menuItems,
  details,
}: {
  server: DirectoryServer
  state: WorldRowState
  expanded: boolean
  onToggleDetails: () => void
  menuOpen: boolean
  onMenuToggle: () => void
  onPrimary?: () => void
  menuItems: ReactNode
  details?: ReactNode
}) {
  const tone = state.tone ?? 'muted'
  return (
    <li className="group flex flex-col" aria-busy={state.label === 'Connecting' || undefined}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          data-world-row-focus
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} details for ${server.name}`}
          onClick={onToggleDetails}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-retro-accent"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[tone]}`} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2 min-w-0">
              <span className="truncate text-sm font-semibold text-retro-fg group-hover:text-retro-accent transition-colors duration-150">
                {server.name}
              </span>
              {state.label && (
                <span className={`shrink-0 text-[10px] uppercase tracking-wider ${LABEL[tone]}`}>
                  {state.label}
                </span>
              )}
              {!!server.password_required && (
                <Lock className="w-3 h-3 shrink-0 text-retro-muted" aria-label="password required" />
              )}
              {!!server.is_private && (
                <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-retro-muted">private</span>
              )}
            </span>
            {state.meta ? (
              <span className="mt-0.5 block truncate text-[10px] text-retro-muted">{state.meta}</span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            className={`w-3.5 h-3.5 shrink-0 text-retro-muted transition-transform duration-150 ${expanded ? 'rotate-180 text-retro-fg' : ''}`}
          />
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {state.counts ? (
            <span className={`hidden sm:inline text-[10px] ${MONO} text-retro-muted`}>{state.counts}</span>
          ) : null}

          {state.label === 'Connecting' ? (
            <span
              data-testid={`connecting-${server.id}`}
              role="status"
              className={`h-7 px-2.5 ${MONO} rounded-lg border border-border-glass bg-glass-w8 flex items-center gap-1.5 text-xs text-retro-fg cursor-wait`}
            >
              <Loader2 className="w-3 h-3 animate-spin text-retro-muted" aria-hidden /> Connecting
            </span>
          ) : state.status ? (
            <span className={`hidden sm:inline text-[10px] ${MONO} text-retro-muted`}>{state.status}</span>
          ) : state.primary ? (
            <button
              type="button"
              disabled={state.primaryDisabled}
              title={state.primaryHint}
              onClick={onPrimary}
              className={`${BTN} ${BTN_SMALL} h-7 min-w-[68px] justify-center inline-flex items-center gap-1.5`}
            >
              {state.primaryIcon}
              {state.primary}
            </button>
          ) : null}

          <div className="relative">
            <button
              type="button"
              data-menu-trigger
              onClick={onMenuToggle}
              aria-label={`More actions for ${server.name}`}
              title="More actions"
              className="h-7 w-7 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w10 flex items-center justify-center cursor-pointer transition-colors duration-150"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            {menuOpen && (
              <div
                data-menu-content
                role="menu"
                aria-label={`Actions for ${server.name}`}
                className="absolute right-0 top-full mt-1 w-52 bg-surface-raised border border-border-glass rounded-lg py-1 shadow-lg z-[var(--z-dropdown)] space-y-0.5 animate-orbit-fade-in"
              >
                {menuItems}
              </div>
            )}
          </div>
        </div>
      </div>

      {expanded && details}
    </li>
  )
}

/** Contextual menu entry — one shape for every row menu. */
export function WorldMenuItem({
  icon,
  label,
  title,
  disabled,
  danger,
  onClick,
}: {
  icon?: ReactNode
  label: string
  title?: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
        danger ? 'text-retro-error hover:bg-retro-error/10' : 'text-retro-fg hover:bg-glass-w10'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
