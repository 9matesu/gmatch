"use client";

import { useState } from 'react';
import { playPress } from '../../utils/sounds';
import { resolveMediaUrl } from '../../utils/media';
import { X, Search, ShieldAlert, Crosshair } from 'lucide-react';
import type { StoreItem, User } from '@orbit/shared';

export function TargetSelectorModal({
  isOpen,
  item,
  users = [],
  profilePics = {},
  myOrbitId,
  currentUserId,
  onClose,
  onConfirmTarget,
}: {
  isOpen: boolean;
  item: StoreItem | null;
  users: User[];
  profilePics?: Record<string, string>;
  myOrbitId?: string;
  currentUserId?: string;
  onClose: () => void;
  onConfirmTarget: (targetUser: User) => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<User | null>(null);

  if (!isOpen || !item) return null;

  const myId = myOrbitId || currentUserId || '';
  const validPeers = users.filter(
    (u) => (u.id || (u as any).orbitId) !== myId && Boolean((u as any).online)
  );

  const filteredPeers = validPeers.filter((u) => {
    const name = u.display_name?.trim() || (u as any).name?.trim() || 'Unknown User';
    return name.toLowerCase().includes(search.toLowerCase());
  });

  const handleConfirm = () => {
    if (!selectedTarget) return;
    playPress(900);
    onConfirmTarget(selectedTarget);
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-system)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-orbit-fade-in font-sans"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised text-retro-fg w-full max-w-md rounded-xl border border-border-glass shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-orbit-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border-glass flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-retro-fg">Pick a player</h3>
              <p className="text-[10px] text-retro-muted">Use {item.name} on them for {item.cost.toLocaleString()} g$</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-retro-muted hover:text-retro-fg hover:bg-surface-interactive cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border-glass bg-surface-raised">
          <div className="relative">
            <Search className="w-4 h-4 text-retro-muted absolute left-3.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search players..."
              className="w-full bg-surface-raised border border-border-glass rounded-xl pl-9 pr-3 py-2 text-xs text-retro-fg outline-none focus:border-retro-error transition-colors placeholder:text-retro-muted"
            />
          </div>
        </div>

        {/* Peers List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-72 styled-scrollbar">
          {filteredPeers.map((peer) => {
            const peerId = peer.id || (peer as any).orbitId;
            const peerName = peer.display_name?.trim() || (peer as any).name?.trim() || 'Unknown User';
            const isSelected = selectedTarget?.id === peerId;
            const pfp = profilePics[peerId];

            return (
              <div
                key={peerId}
                onClick={() => { playPress(750); setSelectedTarget(peer); }}
                className={`p-3 rounded-xl flex items-center justify-between border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-rose-50 border-rose-400 text-rose-950 shadow-xs'
                    : 'bg-surface-raised border-border-glass hover:border-border-glass'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-surface-interactive overflow-hidden border border-border-glass flex items-center justify-center text-xs font-bold text-retro-fg">
                    {pfp ? (
                      <img src={resolveMediaUrl(pfp)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      peerName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <span className="text-xs font-black text-retro-fg block truncate max-w-[180px]">@{peerName}</span>
                    <span className="text-[10px] text-retro-muted font-mono">{peerId.substring(0, 10)}...</span>
                  </div>
                </div>

                <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                  isSelected ? 'border-rose-600 bg-rose-600 text-white' : 'border-border-glass'
                }`}>
                  {isSelected && <Crosshair className="w-3 h-3" />}
                </div>
              </div>
            );
          })}

          {filteredPeers.length === 0 && (
            <div className="py-8 text-center text-xs text-retro-muted italic">
              Nobody is online to target right now.
            </div>
          )}
        </div>

        {/* Footer Action */}
        <div className="p-4 border-t border-border-glass bg-surface-raised flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-surface-raised hover:bg-surface-interactive text-retro-muted border border-border-glass rounded-xl text-xs font-bold cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedTarget}
            className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer shadow-xs transition-colors"
          >
            Use it
          </button>
        </div>
      </div>
    </div>
  );
}
