"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, UsersThree } from '@phosphor-icons/react';
import { generateFallbackName, type User } from '@orbit/shared';
import type { PeerRoster } from '../../utils/peerRoster';
import {
  swarmTransportRegistry,
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

/** The three honest display states. A peer is never called "direct" on
 *  presence alone — only a validated DataChannel earns that label. */
export type PeerChipStatus = 'connected-direct' | 'connecting' | 'cannot-connect';

export const PEER_STATUS_LABEL: Record<PeerChipStatus, string> = {
  'connected-direct': 'Connected direct',
  connecting: 'Connecting',
  'cannot-connect': 'Cannot connect',
};

/**
 * Map the transport registry's five phases onto the three statuses the chip
 * shows. `relay` and `idle` still have frames flowing (over the node), so they
 * read as "connecting" — never as a direct path we cannot prove. An offline
 * roster row is a peer we cannot reach right now.
 */
export function peerChipStatus(peer: User | undefined, phase: PeerTransportPhase): PeerChipStatus {
  if (!peer || peer.online !== true) return 'cannot-connect';
  switch (phase) {
    case 'direct': return 'connected-direct';
    case 'failed': return 'cannot-connect';
    default: return 'connecting';
  }
}

const STATUS_TEXT: Record<PeerChipStatus, string> = {
  'connected-direct': STATUS.success,
  connecting: STATUS.warningSoft,
  'cannot-connect': STATUS.danger,
};
const STATUS_DOT: Record<PeerChipStatus, string> = {
  'connected-direct': 'bg-success-fg',
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
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
  const toggle = () => setOpen((v) => !v);

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
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const visible = peers.filter((p) => !!p?.id && p.id !== selfId);
  const count = visible.filter((p) => p.online === true).length;

  return (
    <div ref={wrapRef} className={classes('relative', 'shrink-0')}>
      <button
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
        <span className={classes(MONO, TYPE.caption)} aria-hidden="true">{count}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Connected peers"
          className={classes(
            'absolute bottom-full right-0 mb-2', 'w-72', 'max-h-[var(--layout-sheet)]', 'overflow-y-auto',
            SURFACE_TONE.raised, RADIUS.panel, SHADOW.panel, PADDING[2],
            MOTION.keyframe.pop, 'origin-bottom-right',
          )}
        >
          <div className={classes('flex items-center justify-between', PADDING_X[1], PADDING_Y[1], 'border-b', COLOR.edge)}>
            <span className={classes(WEIGHT.semibold, TYPE.body, COLOR.fg)}>Peers</span>
            <span className={classes(TYPE.caption, COLOR.muted, MONO)}>{count} online</span>
          </div>

          {visible.length === 0 ? (
            <p className={classes(PADDING[2], TYPE.caption, COLOR.muted)}>No peers connected yet</p>
          ) : (
            <ul className={classes('flex flex-col', GAP[0.5], PADDING_Y[1])}>
              {visible.map((peer) => {
                const status = peerChipStatus(peer, registry.phaseFor(peer.id));
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
      )}
    </div>
  );
}

export default PeerChip;
