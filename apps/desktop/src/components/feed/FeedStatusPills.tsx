"use client";

import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

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
 * Connectivity pill under the feed header. Only the offline conflict is worth a
 * banner: local posts may be stale vs the server, so it is always disclosed.
 * An empty timeline is already explained by the single empty-state card below —
 * a second "empty feed" pill duplicated that message, so it is gone.
 */
export function FeedStatusPills({ postCount }: { postCount: number }) {
  const online = useOnline();

  if (online) return null;

  return (
    <div className="px-3 sm:px-6 pt-2">
      <div
        role="status"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30"
      >
        <WifiOff className="w-3.5 h-3.5" />
        <span>Offline — showing cached posts, may be stale</span>
      </div>
    </div>
  );
}
