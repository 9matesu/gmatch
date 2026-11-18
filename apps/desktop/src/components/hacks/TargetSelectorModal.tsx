"use client";

import { useState } from 'react';
import { playPress } from '../../utils/sounds';
import { resolveMediaUrl } from '../../utils/media';
import { Search, Crosshair } from 'lucide-react';
import { Modal, Button, Caption } from '../../ui/kit';
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
    <Modal title="Pick a player" onClose={onClose} maxWidth="max-w-md">
      <Caption>
        Use {item.name} on them for {item.cost.toLocaleString()} g$
      </Caption>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-retro-muted absolute left-3.5 top-2.5" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players..."
          aria-label="Search players"
          className="w-full bg-glass-w5 border border-edge rounded-lg pl-9 pr-3 py-2 text-xs text-retro-fg outline-none focus:border-retro-accent transition-colors placeholder:text-retro-muted"
        />
      </div>

      {/* Peers List */}
      <div className="space-y-2 max-h-72 overflow-y-auto styled-scrollbar">
        {filteredPeers.map((peer) => {
          const peerId = peer.id || (peer as any).orbitId;
          const peerName = peer.display_name?.trim() || (peer as any).name?.trim() || 'Unknown User';
          const isSelected = selectedTarget?.id === peerId;
          const pfp = profilePics[peerId];

          return (
            <button
              type="button"
              key={peerId}
              onClick={() => { playPress(750); setSelectedTarget(peer); }}
              className={`p-3 rounded-lg flex items-center justify-between border transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-retro-error/10 border-retro-error/40'
                  : 'bg-glass-w5 border-edge hover:border-edge-strong'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-glass-w12 overflow-hidden border border-edge flex items-center justify-center text-xs font-bold text-retro-fg">
                  {pfp ? (
                    <img src={resolveMediaUrl(pfp)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    peerName.charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <span className="text-xs font-semibold text-retro-fg block truncate max-w-[180px]">@{peerName}</span>
                  <span className="text-2xs text-retro-muted font-mono">{peerId.substring(0, 10)}...</span>
                </div>
              </div>

              <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                isSelected ? 'border-retro-error bg-retro-error text-retro-fg' : 'border-edge'
              }`}>
                {isSelected && <Crosshair className="w-3 h-3" />}
              </div>
            </button>
          );
        })}

        {filteredPeers.length === 0 && (
          <div className="py-8 text-center text-xs text-retro-muted italic">
            Nobody is online to target right now.
          </div>
        )}
      </div>

      {/* Footer Action */}
      <div className="pt-3 border-t border-edge flex items-center gap-3">
        <Button className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" className="flex-1" onClick={handleConfirm} disabled={!selectedTarget}>
          Use it
        </Button>
      </div>
    </Modal>
  );
}
