"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, UsersThree } from '@phosphor-icons/react';
import { generateFallbackName, type User } from '@orbit/shared';
import type { PeerRoster } from '../../utils/peerRoster';
import {
  swarmTransportRegistry,
  transportLabel,
  type PeerTransportPhase,
  type TransportRegistry,
} from '../../utils/transportState';
import {
  COLOR,
  GAP,
  ICON,
  MONO,
  MOTION,
  PADDING,
  PADDING_X,
  PADDING_Y,
  RADIUS,
  SHADOW,
  STATUS,
  SURFACE_TONE,
  TYPE,
  WEIGHT,
  classes,
} from '../../ui/tokens';

/** The three honest display states. A relayed peer is still a connected peer:
 *  `direct` and `relay` both collapse into `connected`, so the chip never
 *  distinguishes the transport a peer happens to ride. `connecting` is a
 *  genuinely in-flight dial; `cannot-connect` is a failed or offline peer. */
export type PeerChipStatus = 'connected' | 'connecting' | 'cannot-connect';

export const PEER_STATUS_LABEL: Record<PeerChipStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  'cannot-connect': 'Cannot connect',
};

/**
 * Map the transport registry's five phases onto the three statuses the chip
 * shows. `direct` and `relay` are both a live, settled connection, so they read
 * as `connected` — the user never sees which transport is in use. Only
 * `connecting-direct` is a genuinely in-flight dial (`connecting`); `idle` has
 * no dial in flight and an offline roster row is a peer we cannot reach right
 * now, so both read as `cannot-connect`.
 */
export function peerChipStatus(peer: User | undefined, phase: PeerTransportPhase): PeerChipStatus {
  if (!peer || peer.online !== true) return 'cannot-connect';
  switch (phase) {
    case 'direct': return 'connected';
    case 'relay': return 'connected';
    case 'connecting-direct': return 'connecting';
    default: return 'cannot-connect';
  }
}

const STATUS_TEXT: Record<PeerChipStatus, string> = {
  connected: STATUS.success,
  connecting: STATUS.warningSoft,
  'cannot-connect': STATUS.danger,
};
const STATUS_DOT: Record<PeerChipStatus, string> = {
  connected: 'bg-success-fg',
  connecting: STATUS.warningDot,
  'cannot-connect': 'bg-retro-error',
};

export interface PeerChipProps {
  /** The single roster store. Subscribing here is what keeps the chip live. */
  roster?: PeerRoster;
  /** Static fallback for hosts that already hold a roster snapshot. */
  peers?: User[];
  /** Injectable registry (tests); defaults to the live shared one. */
  registry?: TransportRegistry;
  /** Re-dial handler. Only offered on peers that cannot connect. */
  onRetry?: (peerId: string) => void;
  /** Our own id — never counted as a peer. */
  selfId?: string;
}

/**
 * Small token-based header chip: the real online-peer count, and a popover
 * naming every roster peer with its live transport status. Click (or Enter /
 * Space on the focused button) opens it; Escape and an outside pointerdown
 * close it. The retry button appears only where a dial actually failed.
 */
export function PeerChip({
  roster,
  peers: peersProp,
  registry = swarmTransportRegistry,
  onRetry,
  selfId,
}: PeerChipProps) {
  const [peers, setPeers] = useState<User[]>(() => roster?.list() ?? peersProp ?? []);
  const [, setTransportTick] = useState(0);
  const [open, setOpen] = useState(false);
  /** The popover is `fixed` so the island's own `overflow-x-auto` cannot clip
   *  it; anchored to the trigger on open, never re-measured while it is up. */
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // The roster owns "who is online"; subscribe rather than taking a snapshot
  // so a peer joining or leaving updates the chip without a page reload.
  useEffect(() => {
    if (roster) return roster.subscribe((next) => setPeers(next));
    setPeers(peersProp ?? []);
    return undefined;
  }, [roster, peersProp]);

  // Transport phases live in the shared registry and have their own change
  // event (the roster does not change when a direct dial validates/fails).
  useEffect(() => registry.subscribe(() => setTransportTick((n) => n + 1)), [registry]);

  const close = useCallback(() => setOpen(false), []);
  const toggle = () => {
    if (!open && triggerRef.current && typeof window !== 'undefined') {
      const rect = triggerRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // A `bottom: B` fixed box has its bottom edge at y = vh - B. To sit ABOVE
      // the chip (an 8px gap above rect.top), B = vh - rect.top + 8. Clamp both
      // edges so a chip near a viewport edge cannot push the panel off-screen.
      // The panel is `w-72` (288px); a chip with no room above gets the clamped
      // position rather than an invisible panel above the viewport.
      const bottom = Math.min(
        Math.max(8, vh - rect.top + 8),
        Math.max(8, vh - 8),
      );
      const right = Math.min(
        Math.max(8, vw - rect.right),
        Math.max(8, vw - 288 - 8),
      );
      setAnchor({ right, bottom });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target || wrapRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // A resize would leave a fixed popover anchored to the old coordinates.
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  const visible = peers.filter((p) => !!p?.id && p.id !== selfId);
  // ONE count for every surface: the roster's projection, not a per-component
  // re-count and never a node dashboard number.
  const count = roster
    ? roster.countOnline(selfId)
    : visible.filter((p) => p.online === true).length;

  return (
    <div ref={wrapRef} className={classes('relative', 'shrink-0')}>
      <button
        ref={triggerRef}
        type="button"
        data-peer-chip="true"
        onClick={toggle}
        aria-label={`Peers, ${count} connected`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Connected peers"
        className={classes(
          'relative flex items-center', GAP[1], PADDING_X[2], PADDING_Y[1],
          RADIUS.pill, COLOR.fg, COLOR.hoverFg, COLOR.hoverW8,
          TYPE.body, WEIGHT.medium, MOTION.transition.micro,
          'active:scale-(--scale-press)', 'cursor-pointer',
          'focus-visible:outline-none', 'focus-visible:ring-2', COLOR.focusRing,
          open && COLOR.glassW12,
        )}
      >
        <UsersThree className={ICON.md} weight={open ? 'fill' : 'regular'} aria-hidden="true" />
        {/* Remount on change so the one bounded gacha-ish pop replays; the
            global reduced-motion gate neutralises it for those users. */}
        <span key={count} className={classes(MONO, TYPE.caption, MOTION.keyframe.pop)} aria-hidden="true">{count}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Connected peers"
          style={anchor ? { right: anchor.right, bottom: anchor.bottom } : undefined}
          className={classes(
            'fixed z-[var(--z-picker)]', 'w-72', 'flex flex-col', 'max-h-[var(--layout-sheet)]',
            SURFACE_TONE.raised, RADIUS.panel, SHADOW.panel, PADDING[2],
            MOTION.keyframe.pop, 'origin-bottom-right',
          )}
        >
          <div className={classes('flex items-center justify-between shrink-0', PADDING_X[1], PADDING_Y[1], 'border-b', COLOR.edge)}>
            <span className={classes(WEIGHT.semibold, TYPE.body, COLOR.fg)}>Peers</span>
            <span className={classes(TYPE.caption, COLOR.muted, MONO)}>{count} online</span>
          </div>

          <div className={classes('min-h-0 overflow-y-auto styled-scrollbar', PADDING_Y[1])}>
            {visible.length === 0 ? (
              <p className={classes(PADDING[2], TYPE.caption, COLOR.muted)}>No peers connected yet</p>
            ) : (
              <ul className={classes('flex flex-col', GAP[0.5])}>
                {visible.map((peer) => {
                  const phase = registry.phaseFor(peer.id);
                  const status = peerChipStatus(peer, phase);
                  // Only a LIVE peer may claim a route. `idle`/`connecting`
                  // have no settled path, so they carry no label at all.
                  const route = peer.online === true ? transportLabel(phase) : null;
                  const name = peer.display_name?.trim() || generateFallbackName(peer.id);
                  return (
                    <li
                      key={peer.id}
                      className={classes('flex items-center justify-between', GAP[2], PADDING_X[1], PADDING_Y[1], RADIUS.chip)}
                    >
                      <span className={classes('flex flex-col', 'min-w-0')}>
                        <span className={classes(TYPE.body, COLOR.fg, 'truncate')}>{name}</span>
                        <span className={classes(TYPE.caption, STATUS_TEXT[status], 'flex items-center', GAP[1])}>
                          <span className={classes('w-1.5 h-1.5 rounded-full', STATUS_DOT[status])} aria-hidden="true" />
                          {PEER_STATUS_LABEL[status]}
                          {route && <span className={classes(MONO, COLOR.muted)}>· {route}</span>}
                        </span>
                      </span>
                      {status === 'cannot-connect' && onRetry && (
                        <button
                          type="button"
                          onClick={() => onRetry(peer.id)}
                          aria-label={`Retry connecting to ${name}`}
                          title="Retry connection"
                          className={classes(
                            'flex items-center', GAP[1], PADDING_X[2], PADDING_Y[1],
                            RADIUS.chip, STATUS.dangerBg, STATUS.dangerEdge, STATUS_TEXT['cannot-connect'],
                            STATUS.dangerHover, 'border', TYPE.caption, WEIGHT.medium,
                            MOTION.transition.micro, 'active:scale-(--scale-press)',
                            'focus-visible:outline-none', 'focus-visible:ring-2', COLOR.focusRing,
                          )}
                        >
                          <ArrowClockwise className={ICON.sm} aria-hidden="true" />
                          Retry
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PeerChip;
