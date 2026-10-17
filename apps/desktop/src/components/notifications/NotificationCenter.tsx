"use client";

import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToast, durationFor, type ToastMessage } from '../Toast';

function IconFor({ type }: { type: ToastMessage['type'] }) {
  const cls = 'w-3.5 h-3.5 shrink-0';
  if (type === 'success') return <CheckCircle2 className={`${cls} text-emerald-400`} />;
  if (type === 'error') return <AlertCircle className={`${cls} text-red-400`} />;
  if (type === 'warning') return <AlertTriangle className={`${cls} text-amber-400`} />;
  return <Info className={`${cls} text-retro-body`} />;
}

/**
 * Header notification island: collapsed = one truncated latest line + count;
 * expanded = recent transient items + dismiss. Reads the single transient
 * store (ToastProvider) — the persistent inbox (NotificationsPanel) and OS
 * notifications stay separate and are never counted here.
 */
export function NotificationCenter() {
  const { messages, dismiss, clearAll, overflowCount } = useToast();
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const latest = messages.length ? messages[messages.length - 1] : null;

  // Auto-expire non-sticky items on the header's clock (single owner).
  useEffect(() => {
    const timers = messages
      .map((m) => {
        const ms = durationFor(m.type, m.sticky);
        if (ms === null) return null;
        return setTimeout(() => dismiss(m.id), ms);
      })
      .filter(Boolean) as ReturnType<typeof setTimeout>[];
    return () => { for (const t of timers) clearTimeout(t); };
  }, [messages, dismiss]);

  // Close the expanded panel on route change (hash) so stale context never lingers.
  useEffect(() => {
    if (!expanded) return;
    const close = () => { setExpanded(false); triggerRef.current?.focus(); };
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setExpanded(false); triggerRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <div className="relative min-w-0 flex-1 max-w-md hidden sm:block" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={latest ? `Notifications: ${latest.text}. Activate to ${expanded ? 'collapse' : 'expand'}.` : 'Notifications: none'}
        className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-glass-w10 text-left cursor-pointer transition-colors"
      >
        <span className="relative shrink-0">
          <Bell className="w-3.5 h-3.5 text-retro-muted" />
          {messages.length > 0 && (
            <span aria-hidden className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-retro-accent text-black text-[9px] font-bold flex items-center justify-center">
              {messages.length}
            </span>
          )}
        </span>
        <span aria-live="polite" className="min-w-0 flex-1 truncate text-[11px] text-retro-muted">
          {latest ? latest.text : 'All quiet'}
        </span>
      </button>

      {expanded && (
        <div
          role="region"
          aria-label="Recent notifications"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-80 max-w-[90vw] bg-retro-bg/95 border border-border-glass rounded-lg shadow-2xl backdrop-blur-md z-[var(--z-dropdown)] overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-glass">
            <span className="text-[11px] font-bold text-retro-fg">
              Notifications{overflowCount > 0 && <span className="font-normal text-retro-muted"> · +{overflowCount} more</span>}
            </span>
            <button type="button" onClick={clearAll} className="text-[11px] text-retro-muted hover:text-retro-fg cursor-pointer">
              Clear all
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto divide-y divide-border-subtle">
            {messages.length === 0 && (
              <li className="px-3 py-4 text-[11px] text-retro-muted text-center">Nothing recent.</li>
            )}
            {[...messages].reverse().map((m) => (
              <li key={m.id} className="flex items-start gap-2 px-3 py-2">
                <IconFor type={m.type} />
                <span className="flex-1 min-w-0 text-[11px] text-retro-fg break-words">{m.text}</span>
                <button
                  type="button"
                  onClick={() => dismiss(m.id)}
                  aria-label={`Dismiss: ${m.text}`}
                  className="p-0.5 rounded text-retro-muted hover:text-retro-fg cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
