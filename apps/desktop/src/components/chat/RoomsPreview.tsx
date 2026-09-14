"use client";

// Dock preview (the "miniatura" the user asked for): the Chat dock no longer
// hosts a second full chat — it lists every room/channel with its last line
// and unread cue, and a row opens the unified Rooms chat (GMatchDMs) full
// size. One system, one surface; the dock is just a door.

import { Globe, Gamepad2, Lock, Users, MessageSquare } from 'lucide-react';
import { playPress } from '../../utils/sounds';
import type { ThreadItem } from './GMatchDMs';

export interface PreviewRow {
  id: string;
  kind: 'lobby' | 'queue' | 'room' | 'group' | 'dm';
  name: string;
  last?: string;
  unread?: boolean;
}

export interface RoomsPreviewProps {
  rows: PreviewRow[];
  onOpenRow: (row: PreviewRow) => void;
  onOpenAll: () => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

const ICONS = {
  lobby: Globe,
  queue: Gamepad2,
  room: Lock,
  group: Users,
  dm: MessageSquare,
} as const;

export function RoomsPreview({ rows, onOpenRow, onOpenAll }: RoomsPreviewProps) {
  return (
    <div className="h-full min-h-0 flex flex-col rounded-xl overflow-hidden solid-panel">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-glass shrink-0 bg-glass-w5">
        <span className="text-xs font-medium text-retro-fg flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" />
          Chat
        </span>
        <button
          type="button"
          onClick={() => { playPress(720); onOpenAll(); }}
          className="text-[10px] text-retro-muted hover:text-retro-fg transition-colors cursor-pointer"
        >
          Open rooms →
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-1.5 space-y-0.5">
        {rows.length === 0 && (
          <p className="text-xs text-retro-muted p-3 leading-relaxed">
            No rooms yet. Open chat to join the lobby, create a sealed room, or message someone.
          </p>
        )}
        {rows.map((r) => {
          const Icon = ICONS[r.kind];
          return (
            <button
              key={`${r.kind}:${r.id}`}
              type="button"
              onClick={() => { playPress(760); onOpenRow(r); }}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-glass-w8 transition-colors cursor-pointer"
            >
              <span className="w-7 h-7 rounded-full bg-surface-raised border border-border-glass text-retro-muted shrink-0 flex items-center justify-center">
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-medium text-retro-body truncate">{r.name}</span>
                <span className="block text-[10px] text-retro-muted truncate">{r.last || 'No messages yet'}</span>
              </span>
              {r.unread && <span className="w-1.5 h-1.5 rounded-full bg-retro-accent shrink-0" aria-label="Unread" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Build preview rows from the same state the unified chat renders. Pure so
 * App wiring stays one memo and the shape is testable. */
export function buildPreviewRows(opts: {
  rooms: Array<{ id: string; name: string }>;
  roomLast: (roomId: string) => string | undefined;
  roomUnread: (roomId: string) => boolean;
  groups: Array<{ id: string; name: string }>;
  groupLast: (groupId: string) => string | undefined;
  threads: ThreadItem[];
  myOrbitId?: string;
  readIds?: Set<string>;
  lobbyLast?: string;
  queueLast?: string;
}): PreviewRow[] {
  const rows: PreviewRow[] = [
    { id: 'global_lobby', kind: 'lobby', name: 'Lobby Lounge', last: opts.lobbyLast },
    { id: 'card_queue', kind: 'queue', name: 'Card Queue', last: opts.queueLast },
  ];
  for (const r of opts.rooms) {
    rows.push({ id: r.id, kind: 'room', name: r.name, last: opts.roomLast(r.id), unread: opts.roomUnread(r.id) });
  }
  for (const g of opts.groups) {
    rows.push({ id: g.id, kind: 'group', name: g.name, last: opts.groupLast(g.id) });
  }
  for (const t of opts.threads) {
    if (!t.peer_id || t.peer_id === opts.myOrbitId) continue;
    const unread = Boolean(t.last_sender_id && t.last_sender_id !== opts.myOrbitId && !(opts.readIds?.has(t.peer_id)));
    rows.push({
      id: t.peer_id,
      kind: 'dm',
      name: t.peer_name || 'User',
      last: t.last_body,
      unread,
    });
  }
  return rows;
}
