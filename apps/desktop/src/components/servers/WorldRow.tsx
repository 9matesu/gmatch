"use client";

// One row in the technical server browser. The columns are data the node
// actually reported: status (measured here), address (a privacy-safe hostname,
// never a raw IP), players (host-reported counts, or nothing) and ping (an
// honest dash — this node exposes no latency metric). The row's only click
// target joins or switches; the active row is inert. Everything else lives
// behind the one menu, shared with the right-click actions in ServersView.
//
// SURFACE + TYPOGRAPHY: the grid slots, status dot and every text step come
// from ui/tokens. No per-call colour, radius, shadow, text-size or weight.
import { Loader2, Lock, MoreVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import { serverKey, type DirectoryServer } from './directoryMerge'
import { worldGlyph, worldTileStyle } from './worldIdentity'
import {
  classes, CHROME, COLOR, GAP, ICON, MONO, MOTION, PADDING_X, PADDING_Y,
  PRESENCE, RADIUS, SHADOW, STATUS, TRACKING, TRANSITION,
  TYPE, WEIGHT,
} from '../../ui/tokens'

export interface WorldRowState {
  /** At most one quiet type label, and only when it helps: a world running on
   *  this machine (P2P). Everything else is hosted, which is the norm and
   *  needs no label. */
  kind?: 'P2P'
  /** Status word for the row. Omitted when the row is simply selectable. */
  status?: 'Current' | 'Connecting' | 'Unavailable'
  /** Right-aligned player figure, only when real numbers back it. */
  counts?: string | null
  /** Secondary line: what the world is, never its address (that owns a column). */
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

/** The node reports no round-trip time — its only `/ping` route is an owner
 *  heartbeat that refreshes a listing. A dash is an honest absence, never a
 *  fabricated number. */
const UNMEASURED = '—'

/** Column slots shared by the browser's header strip and every row, so
 *  server / address / players / ping line up down the list. Layout only: the
 *  values here are alignment, not colour, type or spacing design values. */
export const BROWSER_COLUMNS = {
  server: 'min-w-0 flex-1',
  address: 'hidden w-28 shrink-0 truncate sm:block',
  players: 'hidden w-28 shrink-0 truncate text-right sm:block',
  ping: 'hidden w-10 shrink-0 text-right sm:block',
  actions: 'flex w-14 shrink-0 items-center justify-end',
} as const

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
  onContextMenu,
}: {
  server: DirectoryServer
  state: WorldRowState
  menuOpen: boolean
  onMenuToggle: () => void
  onJoin?: () => void
  joinDisabled?: boolean
  menuItems: ReactNode
  /** Right-click opens the same actions in the shared context menu. */
  onContextMenu?: (e: React.MouseEvent<HTMLLIElement>) => void
}) {
  const status = state.status
  const current = status === 'Current'
  const key = serverKey(server)
  const address = formatDomain(server.endpoint_hint)

  const columns = (
    <>
      <span className={classes('flex min-w-0 items-center', GAP[2.5], BROWSER_COLUMNS.server)}>
        {/* Deterministic glyph so two worlds are recognisable at a glance. It
            is chrome, never a reachability claim — status is the dot below. */}
        <span className="relative shrink-0" aria-hidden>
          <span
            className={classes(
              'flex size-9 items-center justify-center border',
              RADIUS.control, TYPE.sub, WEIGHT.bold, COLOR.fgSoft, SHADOW.inset,
            )}
            style={worldTileStyle(key)}
          >
            {worldGlyph(server.name)}
          </span>
          <span
            className={classes(
              'absolute -bottom-0.5 -right-0.5 size-2.5 ring-2 ring-retro-bg',
              RADIUS.pill, status ? DOT[status] : PRESENCE.idleDot,
            )}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className={classes('flex min-w-0 items-baseline', GAP[2])}>
            <span className={classes('truncate', TYPE.sub, WEIGHT.semibold, COLOR.fg, COLOR.hoverAccent, TRANSITION.micro)}>
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
                {status === 'Connecting' && <Loader2 className={classes(ICON.sm, 'animate-spin')} aria-hidden />}
                {status}
              </span>
            )}
            {!!server.password_required && (
              <Lock className={classes(ICON.sm, COLOR.muted)} aria-label="password required" />
            )}
            {!!server.is_private && (
              <span className={classes('shrink-0 uppercase', TYPE.caption, TRACKING.wider, COLOR.muted)}>private</span>
            )}
          </span>
          {state.meta ? (
            <span className={classes('mt-0.5 block truncate', TYPE.caption, COLOR.muted)}>{state.meta}</span>
          ) : null}
        </span>
      </span>
      <span
        className={classes(BROWSER_COLUMNS.address, MONO, TYPE.caption, address ? COLOR.fgSoft : COLOR.faint)}
        title={address || 'No public address reported by this node'}
      >
        {address || UNMEASURED}
      </span>
      <span
        className={classes(BROWSER_COLUMNS.players, MONO, TYPE.caption, state.counts ? COLOR.fgSoft : COLOR.faint)}
        title={state.counts || 'No player counts reported by this node'}
      >
        {state.counts || UNMEASURED}
      </span>
      <span className={classes(BROWSER_COLUMNS.ping, MONO, TYPE.caption, COLOR.faint)} title="This node reports no latency measurement">
        {UNMEASURED}
      </span>
    </>
  )

  return (
    <li
      className={classes(
        'group relative flex items-center', PADDING_Y[2.5], PADDING_X[3],
        GAP[2], TRANSITION.micro, current ? COLOR.selectionBg : COLOR.hoverW5,
      )}
      aria-current={current || undefined}
      aria-busy={status === 'Connecting' || undefined}
      onContextMenu={onContextMenu}
    >
      {current ? (
        <span
          data-world-row-focus
          tabIndex={-1}
          aria-label={`${server.name}, current server`}
          className={classes('flex min-w-0 flex-1 items-center text-left', GAP[2], RADIUS.chip)}
        >
          {columns}
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
            GAP[2], RADIUS.chip, COLOR.focusRing,
            status === 'Connecting' ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed',
          )}
        >
          {columns}
        </button>
      )}

      <div className={classes(BROWSER_COLUMNS.actions, GAP[1])}>
        {!current && (
          <span aria-hidden className={classes('hidden uppercase', TYPE.caption, TRACKING.wider, COLOR.muted, 'sm:inline')}>
            join
          </span>
        )}
        <div className="relative">
          <button
            type="button"
            data-menu-trigger
            onClick={onMenuToggle}
            aria-label={`More actions for ${server.name}`}
            title="More actions"
            className={classes('flex size-7 items-center justify-center cursor-pointer', CHROME.iconButton)}
          >
            <MoreVertical className={ICON.sm} />
          </button>

          {menuOpen && (
            <div
              data-menu-content
              role="menu"
              aria-label={`Actions for ${server.name}`}
              className={classes(
                'absolute right-0 top-full mt-1 w-52 py-1 z-[var(--z-dropdown)]',
                CHROME.popover, SHADOW.large, MOTION.keyframe.fadeIn,
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
