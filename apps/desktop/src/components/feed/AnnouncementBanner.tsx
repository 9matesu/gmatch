"use client";

import { useCallback, useState } from 'react';
import { Megaphone, X } from 'lucide-react';

/**
 * The node's active announcement, shown at the top of the feed.
 *
 * This feature was HALF-WIRED: the admin panel publishes announcements
 * ("Broadcast Banner Notices — shown at the top of player screens"), the
 * node serves the newest active one at GET /api/announcements, and App.tsx
 * fetched it on every sync — into a state slot nobody read. The fetch result
 * was discarded, so an admin could publish a banner and no player would ever
 * see it.
 *
 * Dismissal is per-announcement (by id) and persisted, so a NEW announcement
 * shows up even if the previous one was dismissed.
 */

export interface Announcement {
  id: string;
  message: string;
  created_at: string;
  created_by_name: string | null;
}

const DISMISSED_KEY = 'gmatch.announcement.dismissed.v1';

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISSED_KEY) || '';
  } catch {
    return '';
  }
}

export function AnnouncementBanner({ announcement }: { announcement: Announcement | null }) {
  const [dismissedId, setDismissedId] = useState<string>(() => readDismissed());

  const dismiss = useCallback(() => {
    if (!announcement) return;
    setDismissedId(announcement.id);
    try {
      localStorage.setItem(DISMISSED_KEY, announcement.id);
    } catch {
      // A storage failure only means the banner returns on the next mount.
    }
  }, [announcement]);

  if (!announcement || !announcement.message || announcement.id === dismissedId) return null;

  return (
    <div
      role="status"
      data-testid="announcement-banner"
      className="mb-3 flex items-start gap-3 rounded-xl border border-retro-accent/40 bg-retro-panel/90 px-3 py-2.5 backdrop-blur-md"
    >
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-retro-accent" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-retro-fg">{announcement.message}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="shrink-0 cursor-pointer rounded-md p-1 text-retro-muted transition-colors hover:bg-glass-w10 hover:text-retro-fg"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
