"use client";

import { useEffect, useState } from 'react';
import { WifiOff, Ghost } from 'lucide-react';

/** Live connectivity: navigator.onLine at mount + online/offline events. */
function useOnline(): boolean {
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}

/**
 * Selective timeline status pills. Rendered under the feed header, but ONLY
 * in empty/conflict states — a healthy timeline shows no pills at all:
 * - offline (with or without posts): amber "cached posts" pill. Local posts
 *   may be stale vs the server, so the conflict is always disclosed.
 * - online + zero posts: quiet empty-feed pill (the nudge card below carries
 *   the follow suggestions and actions; the pill is just the status line).
 */
export function FeedStatusPills({ postCount }: { postCount: number }) {
  const online = useOnline();

  if (online && postCount > 0) return null;

  return (
    <div className="px-3 sm:px-6 pt-2">
      {!online ? (
        <div
          role="status"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30"
        >
          <WifiOff className="w-3.5 h-3.5" />
          <span>Offline — showing cached posts, may be stale</span>
        </div>
      ) : (
        <div
          role="status"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-glass-w8 text-retro-muted border border-border-glass"
        >
          <Ghost className="w-3.5 h-3.5" />
          <span>Empty feed — start posting and get things moving</span>
        </div>
      )}
    </div>
  );
}
