"use client";

// One row for every server in the Browser: the node running on this machine,
// directory destinations, and the official gMatch Central entry. Identity leads,
// infrastructure is a second line, and a row carries exactly one action
// (join / switch — clicking the row) plus its contextual menu. Behaviour stays
// in ServersView: this file owns layout, the vocabulary (P2P, Current /
// Connecting / Unavailable) and the two format helpers the row needs. A row
// never claims reachability it has not measured.
//
// SURFACE + TYPOGRAPHY: the tile, its menu, the status dot and every text step
// come from ui/tokens. No per-call colour, radius, shadow, text-size or weight.
import { Loader2, Lock, MoreVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import { serverKey, type DirectoryServer } from './directoryMerge'
import { worldAccentStyle, worldGlyph, worldTileStyle } from './worldIdentity'
import {
  classes, COLOR, GAP, ICON, MONO, PADDING_X, PADDING_Y,
  PRESENCE, RADIUS, RECIPE, SHADOW, STATUS, TRACKING, TRANSITION,
  TYPE, WEIGHT,
} from '../../ui/tokens'

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
  Current: PRESENCE.currentDot,
  Connecting: PRESENCE.connectingDot,
  Unavailable: PRESENCE.idleDot,
}

const STATUS_TONE: Record<NonNullable<WorldRowState['status']>, string> = {
  Current: PRESENCE.currentText,
  Connecting: PRESENCE.connectingText,
  Unavailable: PRESENCE.idleText,
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
  const key = serverKey(server)
  const body = (
    <>
      {/* World identity: a deterministic colour + glyph so two worlds are
          recognisable at a glance. It is chrome, never a reachability claim —
          the measured status is the dot on the tile's corner. */}
      <span className="relative shrink-0" aria-hidden>
        <span
          className={classes(
            'flex h-9 w-9 items-center justify-center border',
            RADIUS.control, TYPE.sub, WEIGHT.bold, COLOR.fgSoft, SHADOW.inset,
          )}
          style={worldTileStyle(key)}
        >
          {worldGlyph(server.name)}
        </span>
        <span
          className={classes(
            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 ring-2 ring-retro-bg',
            RADIUS.pill, status ? DOT[status] : PRESENCE.idleDot,
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className={classes('flex min-w-0 items-baseline', GAP[2])}>
          <span className={classes('truncate group-hover:text-retro-accent', TYPE.sub, WEIGHT.semibold, COLOR.fg, TRANSITION.micro)}>
            {server.name}
          </span>
          {state.kind && (
            <span className={classes('shrink-0 uppercase', TYPE.caption, TRACKING.wider, COLOR.muted)}>{state.kind}</span>
          )}
          {status && (
            <span
              data-testid={status === 'Connecting' ? `connecting-${server.id}` : undefined}
              className={classes('flex shrink-0 items-center uppercase', GAP[1], TYPE.caption, TRACKING.wider, STATUS_TONE[status])}
            >
              {status === 'Connecting' && <Loader2 className="w-3 h-3 animate-spin" aria-hidden />}
              {status}
            </span>
          )}
          {!!server.password_required && (
            <Lock className={classes('w-3 h-3 shrink-0', COLOR.muted)} aria-label="password required" />
          )}
          {!!server.is_private && (
            <span className={classes('shrink-0 uppercase', TYPE.caption, TRACKING.wider, COLOR.muted)}>private</span>
          )}
        </span>
        {state.meta ? (
          <span className={classes('mt-0.5 block truncate', TYPE.caption, COLOR.muted)}>{state.meta}</span>
        ) : null}
      </span>
    </>
  )

  return (
    <li
      className={classes(
        'group relative flex items-center py-2.5 pl-4 pr-3',
        GAP[3], TRANSITION.micro, current ? COLOR.glassW8 : COLOR.hoverW5,
      )}
      aria-current={current || undefined}
      aria-busy={status === 'Connecting' || undefined}
    >
      {/* The connected world keeps a colour rail so "where am I" never needs
          reading a label. */}
      {current && (
        <span
          aria-hidden
          className={classes('absolute inset-y-1.5 left-0 w-0.5', RADIUS.pill)}
          style={worldAccentStyle(key)}
        />
      )}
      {current ? (
        <span
          data-world-row-focus
          tabIndex={-1}
          aria-label={`${server.name}, current server`}
          className={classes('flex min-w-0 flex-1 items-center focus-visible:outline-none', GAP[2.5], RADIUS.chip)}
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
          className={classes(
            'flex min-w-0 flex-1 items-center text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 disabled:opacity-70',
            GAP[2.5], RADIUS.chip, COLOR.focusRing,
            status === 'Connecting' ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed',
          )}
        >
          {body}
        </button>
      )}

      <div className={classes('flex shrink-0 items-center', GAP[2])}>
        {/* Fixed slot so the ⋯ column lines up down the list, whether or not a
            row has a figure the server actually reported. */}
        <span className={classes('hidden sm:inline-block w-28 text-right', TYPE.caption, MONO, COLOR.muted)}>
          {state.counts ?? ''}
        </span>

        <div className="relative">
          <button
            type="button"
            data-menu-trigger
            onClick={onMenuToggle}
            aria-label={`More actions for ${server.name}`}
            title="More actions"
            className={classes(
              'h-7 w-7 flex items-center justify-center cursor-pointer',
              RADIUS.chip, COLOR.muted, COLOR.hoverFg, COLOR.hoverW10, TRANSITION.micro,
            )}
          >
            <MoreVertical className={ICON.sm} />
          </button>

          {menuOpen && (
            <div
              data-menu-content
              role="menu"
              aria-label={`Actions for ${server.name}`}
              className={classes(
                'absolute right-0 top-full mt-1 w-52 py-1 z-[var(--z-dropdown)] space-y-0.5 animate-orbit-fade-in',
                RECIPE.card, COLOR.surfaceRaised, SHADOW.large,
              )}
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
      className={classes(
        'w-full text-left flex items-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
        PADDING_X[3], PADDING_Y[1.5], GAP[2], TRANSITION.micro, TYPE.body,
        danger ? classes(STATUS.danger, STATUS.dangerHoverBg) : classes(COLOR.fg, COLOR.hoverW10),
      )}
    >
      {icon}
      {label}
    </button>
  )
}
