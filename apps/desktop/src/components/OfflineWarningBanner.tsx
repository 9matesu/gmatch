"use client";

import { useState, useEffect } from "react";
import { orbitFetch } from "../utils/api";
import type { OrbitIdentity } from "@orbit/crypto";
import { AlertOctagon, AlertTriangle } from "lucide-react";

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
            
            const WARNING_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;
            const DELETION_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

            if (offlineMs >= WARNING_THRESHOLD_MS && offlineMs < DELETION_THRESHOLD_MS) {
              const hoursLeft = Math.ceil((DELETION_THRESHOLD_MS - offlineMs) / (60 * 60 * 1000));
              setWarning({ daysOffline: offlineDays, hoursLeft });
            }
          }
        }
      } catch {
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
      className={`fixed top-0 left-0 right-0 z-50 px-4 py-3 border-b ${
        isCritical
          ? "bg-retro-bg/95 border-red-500/30 text-retro-fg"
          : "bg-retro-bg/95 border-amber-500/30 text-retro-fg"
      } backdrop-blur-md shadow-md animate-orbit-slide-up`}
      role="alert"
      aria-live={isCritical ? "assertive" : "polite"}
    >
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="shrink-0" aria-hidden="true">
            {isCritical ? (
              <AlertOctagon className="w-5 h-5 text-red-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            )}
          </span>
          <div className="text-xs leading-relaxed font-sans text-retro-fg">
            <strong className={`font-semibold block ${isCritical ? "text-red-400" : "text-amber-400"}`}>
              {isCritical ? "Account expires soon" : "Account at risk"}
            </strong>
            You&apos;ve been offline for <strong className="text-retro-fg font-mono">{warning.daysOffline} day(s)</strong>. 
            Your account and all content will be permanently deleted{" "}
            {isCritical ? (
              <>in <strong className="text-red-300 font-mono">{warning.hoursLeft} hour(s)</strong>.</>
            ) : (
              <>in ~<strong className="text-amber-300 font-mono">{warning.hoursLeft} hour(s)</strong>.</>
            )}{" "}
            Log in now to keep your data.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              setDismissed(true);
              setTimeout(() => setDismissed(false), 30 * 60 * 1000);
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border-glass bg-retro-panel text-retro-fg hover:text-white hover:bg-glass-w12 transition-all duration-150 active:scale-[0.96] cursor-pointer"
            aria-label="Dismiss warning for 30 minutes"
          >
            Dismiss
          </button>
          <a
            href="/"
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 active:scale-[0.96] shadow-xs ${
              isCritical
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-white text-retro-bg hover:bg-retro-fg"
            }`}
          >
            Log in now
          </a>
        </div>
      </div>
    </div>
  );
}