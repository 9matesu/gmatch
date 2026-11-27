"use client";

import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { CHROME, classes, GAP, ICON, PADDING_X, PADDING_Y } from '../../ui/tokens';

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
 *
 * The warning tint is `STATUS.warning*` — one role, readable in both themes —
 * and the pill's type/radius/gap come from the token scale, never per call.
 */
export function FeedStatusPills() {
  const online = useOnline();

  if (online) return null;

  return (
    <div className={classes(PADDING_X[3], 'sm:px-6 pt-2')}>
      <div
        role="status"
        className={classes('inline-flex items-center border', GAP[1.5], PADDING_X[3], PADDING_Y[1.5], CHROME.warningPill)}
      >
        <WifiOff className={ICON.sm} />
        <span>Offline — showing cached posts, may be stale</span>
      </div>
    </div>
  );
}
