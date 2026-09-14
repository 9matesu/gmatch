"use client";

// Minimized-chat bubble content for the mobile drawer path. The full chat is
// the unified rooms chat (GMatchDMs) rendered by App for #/messages and
// #/rooms; the desktop dock shows the RoomsPreview instead.

import type { User } from '@orbit/shared';

export function DmMinimizedView({
  pmPeer,
  profilePics,
}: {
  pmPeer: User | null;
  profilePics: Record<string, string>;
}) {
  return (
    <div className="w-full flex items-center justify-center py-10">
      <div className="text-center space-y-3">
        <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-tr from-cyan-500 via-teal-500 to-amber-500 p-[3px]">
          <div className="w-full h-full rounded-full bg-surface-canvas overflow-hidden flex items-center justify-center text-sm font-bold text-retro-muted">
            {pmPeer ? (
              profilePics[pmPeer.id || (pmPeer as any).orbitId || ''] ? (
                <img src={profilePics[pmPeer.id || (pmPeer as any).orbitId || '']} alt="" className="w-full h-full object-cover" />
              ) : (
                (pmPeer.display_name || 'P').charAt(0).toUpperCase()
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
