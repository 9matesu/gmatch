"use client";

// Ares-style chat rooms over the blind courier (plan P3.4 UI). SITE mode only:
// App renders this exclusively when courierActive — on full nodes the room
// fan-out exists but DMs still ride the legacy inbox, and we do not ship two
// half-lives of the same feature. Room state (DEK + members) lives ONLY in
// this device's localStorage (scoped per identity); the courier sees nothing
// but opaque per-member mail envelopes.

import { useMemo, useState } from 'react';
import { Send, Users, LogOut, Plus, KeyRound } from 'lucide-react';
import type { User } from '@orbit/shared';
import type { Room } from '../../utils/rooms';
import { playPress } from '../../utils/sounds';

interface RoomsViewProps {
  rooms: Room[];
  roomMessages: (roomId: string) => Array<{ id: string; senderOrbitId: string; text: string; ts: number }>;
  users: User[];
  myOrbitId: string;
  onCreateRoom: (name: string) => Room | null;
  onInvite: (roomId: string, peerId: string) => Promise<boolean>;
  onSay: (roomId: string, text: string) => Promise<string | null>;
  onLeave: (roomId: string) => void;
  toast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

function shortId(id: string): string {
  return id.slice(0, 6) + '…' + id.slice(-4);
}

export function RoomsView({
  rooms,
  roomMessages,
  users,
  myOrbitId,
  onCreateRoom,
  onInvite,
  onSay,
  onLeave,
  toast,
}: RoomsViewProps) {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(rooms[0]?.id ?? null);
  const [newName, setNewName] = useState('');
  const [draft, setDraft] = useState('');
  const [invitePeer, setInvitePeer] = useState('');

  const activeRoom = useMemo(() => rooms.find((r) => r.id === activeRoomId) || null, [rooms, activeRoomId]);
  const messages = activeRoom ? roomMessages(activeRoom.id) : [];
  const nameOf = (orbitId: string) =>
    orbitId === myOrbitId ? 'You' : (users.find((u) => u.id === orbitId)?.display_name || shortId(orbitId));

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    const room = onCreateRoom(name);
    if (room) {
      setActiveRoomId(room.id);
      setNewName('');
      toast(`Room "${room.name}" created — invite people to fill it`, 'success');
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || !activeRoom) return;
    playPress(920);
    void onSay(activeRoom.id, text);
    setDraft('');
  };

  const invite = async () => {
    if (!activeRoom) return;
    const target = users.find(
      (u) => (u.display_name || '').toLowerCase() === invitePeer.trim().toLowerCase() || u.id === invitePeer.trim(),
    );
    if (!target) {
      toast('No contact with that name/id — share a GMatch ID or DM them once first', 'error');
      return;
    }
    const ok = await onInvite(activeRoom.id, target.id);
    toast(ok ? `${target.display_name || 'Peer'} invited (sealed)` : 'Invite failed — unknown keys or already inside', ok ? 'success' : 'error');
    if (ok) setInvitePeer('');
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-3 py-4 flex gap-4 h-[calc(100vh-140px)] font-sans text-retro-fg">
      {/* Room list (Ares lobby column) */}
      <aside className="glass-card w-60 shrink-0 flex flex-col rounded-xl overflow-hidden">
        <div className="p-3 border-b border-border-glass flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-retro-muted">
          <Users className="w-4 h-4" /> Rooms
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {rooms.length === 0 && (
            <p className="text-xs text-retro-muted p-2 leading-relaxed">
              No rooms yet. A room is an end-to-end encrypted group chat — its key lives only on your devices and the members you invite.
            </p>
          )}
          {rooms.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { playPress(720); setActiveRoomId(r.id); }}
              className={`glass-nav-item ${activeRoomId === r.id ? 'glass-nav-active' : ''} w-full text-left px-3 py-2 rounded-lg text-xs cursor-pointer`}
            >
              <span className="block truncate font-medium">{r.name}</span>
              <span className="block text-[10px] text-retro-muted">{r.members.length} member{r.members.length === 1 ? '' : 's'} · e{r.epoch}</span>
            </button>
          ))}
        </div>
        <div className="p-2 border-t border-border-glass flex gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
            placeholder="new room name"
            className="glass-field flex-1 min-w-0 px-2 py-1.5 text-xs"
          />
          <button type="button" onClick={create} aria-label="Create room" className="glass-action glass-action-primary p-1.5 rounded-lg cursor-pointer">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Chat pane */}
      <section className="glass-card flex-1 min-w-0 flex flex-col rounded-xl overflow-hidden">
        {activeRoom ? (
          <>
            <header className="px-4 py-2.5 border-b border-border-glass flex items-center gap-3">
              <h2 className="text-sm font-bold truncate">{activeRoom.name}</h2>
              <span className="text-[10px] text-retro-muted flex items-center gap-1" title="Room key epoch — bumps when a member leaves">
                <KeyRound className="w-3 h-3" /> epoch {activeRoom.epoch}
              </span>
              <div className="ml-auto flex items-center gap-2 text-[10px] text-retro-muted">
                {activeRoom.members.map((m) => (
                  <span key={m} className={`px-1.5 py-0.5 rounded-full border border-border-glass ${m === activeRoom.ownerId ? 'text-retro-accent' : ''}`}>
                    {nameOf(m)}
                  </span>
                ))}
              </div>
              {activeRoom.ownerId !== myOrbitId && (
                <button
                  type="button"
                  onClick={() => { playPress(520); onLeave(activeRoom.id); if (rooms[0]?.id !== activeRoom.id) setActiveRoomId(rooms.find(r2 => r2.id !== activeRoom.id)?.id ?? null); toast(`Left "${activeRoom.name}" — the owner re-wraps its key`, 'info'); }}
                  className="glass-action glass-action-danger p-1.5 rounded-lg cursor-pointer"
                  aria-label="Leave room"
                  title="Leave room"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-xs text-retro-muted">
                  No messages yet — everything typed here is sealed with the room key; {activeRoom.members.length - 1} other device(s) can open it.
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`max-w-[75%] ${m.senderOrbitId === myOrbitId ? 'ml-auto' : ''}`}>
                  {m.senderOrbitId !== myOrbitId && (
                    <div className="text-[10px] text-retro-muted mb-0.5">{nameOf(m.senderOrbitId)}</div>
                  )}
                  <div className={`px-3 py-2 rounded-lg text-xs leading-relaxed whitespace-pre-wrap break-words ${m.senderOrbitId === myOrbitId ? 'glass-nav-active rounded-br-sm' : 'glass-inset rounded-bl-sm'}`}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-border-glass p-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  value={invitePeer}
                  onChange={(e) => setInvitePeer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void invite(); }}
                  placeholder="invite a contact by name or id…"
                  className="glass-field flex-1 min-w-0 px-3 py-1.5 text-xs"
                />
                <button type="button" onClick={() => void invite()} className="glass-action px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer">
                  Invite
                </button>
              </div>
              <div className="flex gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  rows={1}
                  placeholder={`Message ${activeRoom.name}… (sealed to every member)`}
                  className="glass-field flex-1 resize-none px-3 py-2 text-xs"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!draft.trim()}
                  className="glass-action glass-action-primary px-3 rounded-lg disabled:opacity-30 cursor-pointer"
                  aria-label="Send"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
            <Users className="w-6 h-6 text-retro-muted" />
            <p className="text-xs text-retro-muted max-w-xs">
              Create a room to start an end-to-end encrypted group chat. Nothing the courier stores can be read by anyone but the members.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
