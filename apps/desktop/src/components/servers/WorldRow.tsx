"use client";

// One row for every server in the Browser: the node running on this machine,
// directory destinations, and the official gMatch Central entry. Identity leads,
// infrastructure is a second line, and a row carries exactly one action
// (join / switch — clicking the row) plus its contextual menu. Behaviour stays
// in ServersView: this file owns layout, the vocabulary (P2P, Current /
// Connecting / Unavailable) and the two format helpers the row needs. A row
// never claims reachability it has not measured.
import { Loader2, Lock, MoreVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import type { DirectoryServer } from './directoryMerge'
import { MONO } from '../../ui/styles'

export interface WorldRowState {
  /** At most one quiet type label, and only when it helps: a world running on
   *  this machine (P2P). Everything else is hosted, which is the norm and
   *  needs no label. */
  kind?: 'P2P'
  /** Status word for the row. Omitted when the row is simply selectable. */
  status?: 'Current' | 'Connecting' | 'Unavailable'
  /** Right-aligned figure, only when real numbers back it (never a placeholder). */
  counts?: string | null
  /** Secondary line: description · domain · listed 2h ago. Hidden when empty. */
  meta?: string
}

const DOT: Record<NonNullable<WorldRowState['status']>, string> = {
  Current: 'bg-retro-online',
  Connecting: 'bg-retro-warning',
  Unavailable: 'bg-retro-muted/40',
}

const STATUS_TONE: Record<NonNullable<WorldRowState['status']>, string> = {
  Current: 'text-retro-online',
  Connecting: 'text-retro-warning',
  Unavailable: 'text-retro-muted',
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

/**
 * The row's only click target joins or switches; the active row is inert
 * (clicking it must not reconnect). Everything else lives behind the menu.
 */
export function WorldRow({
  server,
  state,
  menuOpen,
  onMenuToggle,
  onJoin,
  joinDisabled,
  menuItems,
}: {
  server: DirectoryServer
  state: WorldRowState
  menuOpen: boolean
  onMenuToggle: () => void
  onJoin?: () => void
  joinDisabled?: boolean
  menuItems: ReactNode
}) {
  const status = state.status
  const current = status === 'Current'
  const body = (
    <>
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${status ? DOT[status] : 'bg-retro-muted/40'}`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-retro-fg group-hover:text-retro-accent transition-colors duration-150">
            {server.name}
          </span>
          {state.kind && (
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-retro-muted">{state.kind}</span>
          )}
          {status && (
            <span
              data-testid={status === 'Connecting' ? `connecting-${server.id}` : undefined}
              className={`flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wider ${STATUS_TONE[status]}`}
            >
              {status === 'Connecting' && <Loader2 className="w-3 h-3 animate-spin" aria-hidden />}
              {status}
            </span>
          )}
          {!!server.password_required && (
            <Lock className="w-3 h-3 shrink-0 text-retro-muted" aria-label="password required" />
          )}
          {!!server.is_private && (
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-retro-muted">private</span>
          )}
        </span>
        {state.meta ? (
          <span className="mt-0.5 block truncate text-[10px] text-retro-muted">{state.meta}</span>
        ) : null}
      </span>
    </>
  )

  return (
    <li
      className={`group flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 ${
        current ? 'bg-glass-w8' : 'hover:bg-glass-w5'
      }`}
      aria-current={current || undefined}
      aria-busy={status === 'Connecting' || undefined}
    >
      {current ? (
        <span
          data-world-row-focus
          tabIndex={-1}
          aria-label={`${server.name}, current server`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md focus-visible:outline-none"
        >
          {body}
        </span>
      ) : (
        <button
          type="button"
          data-world-row-focus
          onClick={onJoin}
          disabled={joinDisabled}
          aria-label={`Connect to ${server.name}`}
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-retro-accent disabled:opacity-70 ${
            status === 'Connecting' ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed'
          }`}
        >
          {body}
        </button>
      )}

      <div className="flex shrink-0 items-center gap-2">
        {/* Fixed slot so the ⋯ column lines up down the list, whether or not a
            row has a figure the server actually reported. */}
        <span className={`hidden sm:inline-block w-16 text-right text-[10px] ${MONO} text-retro-muted`}>
          {state.counts ?? ''}
        </span>

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
