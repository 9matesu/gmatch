"use client";

import { useState, useEffect } from "react";
import { orbitFetch } from "../utils/api";
import type { OrbitIdentity } from "@orbit/crypto";

interface OfflineWarningData {
  daysOffline: number;
  hoursLeft: number;
}

export function OfflineWarningBanner({ identity }: { identity: OrbitIdentity | null }) {
  const [warning, setWarning] = useState<OfflineWarningData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!identity) {
      setLoading(false);
      return;
    }

    const checkWarning = async () => {
      try {
        const res = await orbitFetch("/api/users/me", { method: "GET" }, identity);
        if (res.ok) {
          const data = await res.json();
          if (data.last_seen) {
            const lastSeen = new Date(data.last_seen).getTime();
            const now = Date.now();
            const offlineMs = now - lastSeen;
            const offlineDays = Math.floor(offlineMs / (24 * 60 * 60 * 1000));
            const offlineHours = Math.floor(offlineMs / (60 * 60 * 1000));
            
            const WARNING_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;
            const DELETION_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

            if (offlineMs >= WARNING_THRESHOLD_MS && offlineMs < DELETION_THRESHOLD_MS) {
              const hoursLeft = Math.ceil((DELETION_THRESHOLD_MS - offlineMs) / (60 * 60 * 1000));
              setWarning({ daysOffline: offlineDays, hoursLeft });
            }
          }
        }
      } catch (err) {
      } finally {
        setLoading(false);
      }
    };

    checkWarning();
    const interval = setInterval(checkWarning, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [identity]);

  if (loading || !warning || dismissed) {
    return null;
  }

  const isCritical = warning.hoursLeft <= 24;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 px-4 py-3 border-b border-border-glass ${
        isCritical ? "bg-red-950/95 text-red-100" : "bg-yellow-950/95 text-yellow-100"
      } animate-slide-down`}
      role="alert"
      aria-live={isCritical ? "assertive" : "polite"}
    >
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="flex-shrink-0 text-lg" aria-hidden="true">
            {isCritical ? "🚨" : "⚠️"}
          </span>
          <div className="text-sm font-mono leading-relaxed">
            <strong>{isCritical ? "ACCOUNT EXPIRES SOON" : "ACCOUNT AT RISK"}</strong>
            <br />
            You&apos;ve been offline for <strong>{warning.daysOffline} day(s)</strong>. 
            Your account and all content will be <strong>permanently deleted</strong>{" "}
            {isCritical
              ? `in <strong>${warning.hoursLeft} hour(s)</strong>.`
              : `in ~<strong>${warning.hoursLeft} hour(s)</strong>.`}
            {" "}
            Log in now to keep your data.
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => {
              setDismissed(true);
              setTimeout(() => setDismissed(false), 30 * 60 * 1000);
            }}
            className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded border ${
              isCritical
                ? "bg-red-900 text-red-100 border-red-500/50 hover:bg-red-800"
                : "bg-yellow-900 text-yellow-100 border-yellow-500/50 hover:bg-yellow-800"
            } transition-colors`}
            aria-label="Dismiss warning for 30 minutes"
          >
            Dismiss
          </button>
          <a
            href="/"
            className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded border ${
              isCritical
                ? "bg-red-600 text-white border-red-500 hover:bg-red-500"
                : "bg-yellow-600 text-white border-yellow-500 hover:bg-yellow-500"
            } transition-colors`}
          >
            Log In Now
          </a>
        </div>
      </div>
    </div>
  );
}