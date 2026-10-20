"use client";

// Minimized-chat bubble content for the mobile drawer path. The full chat is
// the unified rooms chat (GMatchDMs) rendered by App for #/messages and
// #/rooms; the desktop dock shows the RoomsPreview instead.

import type { ChatPeer } from '../chat/chatPeer';
import { resolveMediaUrl } from '../../utils/media';

export function DmMinimizedView({
  pmPeer,
  profilePics,
}: {
  pmPeer: ChatPeer | null;
  profilePics: Record<string, string>;
}) {
  return (
    <div className="w-full flex items-center justify-center py-10">
      <div className="text-center space-y-3">
        <div className="mx-auto w-16 h-16 rounded-full bg-glass-w20 p-[3px]">
          <div className="w-full h-full rounded-full bg-surface-canvas overflow-hidden flex items-center justify-center text-sm font-bold text-retro-muted">
            {pmPeer ? (
              profilePics[pmPeer.id] ? (
                <img src={resolveMediaUrl(profilePics[pmPeer.id])} alt="" className="w-full h-full object-cover" />
              ) : (
                (pmPeer.name || 'P').charAt(0).toUpperCase()
              )
            ) : (
              'D'
            )}
          </div>
        </div>
        <p className="text-xs font-bold text-retro-body">Direct Messages minimized</p>
        <p className="text-xs text-retro-muted">Open the chat bubble at the bottom to keep talking.</p>
      </div>
    </div>
  );
}
