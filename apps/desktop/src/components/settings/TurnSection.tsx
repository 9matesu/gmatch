"use client";

import { useState } from 'react';
import { CheckCircle, Trash } from 'lucide-react';

/**
 * Settings > Preferences: add a TURN relay at runtime.
 *
 * Two peers behind CGNAT (symmetric NAT) with no reachable node cannot meet on
 * STUN alone. A TURN relay both can reach fixes that (relay-forced, zero IP
 * exposure). Stored in localStorage and read by every P2P stack; env stays
 * authoritative. Nothing is baked in - the user supplies their own relay.
 */

const KEY = 'gmatch.turn.v1';

type Turn = { url: string; username: string; credential: string };

function read(): Turn {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const p = raw ? JSON.parse(raw) : {};
    return { url: p.url || '', username: p.username || '', credential: p.credential || '' };
  } catch {
    return { url: '', username: '', credential: '' };
  }
}

export function TurnSection({ toast }: { toast?: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const [t, setT] = useState<Turn>(read);
  const [saved, setSaved] = useState(false);

  const save = () => {
    const url = t.url.trim();
    const ok = url && t.username.trim() && t.credential;
    try {
      if (ok) localStorage.setItem(KEY, JSON.stringify({ url, username: t.username.trim(), credential: t.credential }));
      else localStorage.removeItem(KEY);
      setSaved(true);
      toast?.(ok ? 'TURN relay saved - new connections use it' : 'TURN relay cleared', ok ? 'success' : 'info');
    } catch {
      toast?.('Could not save the TURN relay', 'error');
    }
  };

  const clear = () => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    setT({ url: '', username: '', credential: '' });
    setSaved(true);
    toast?.('TURN relay cleared', 'info');
  };

  const field = (k: keyof Turn, label: string, type = 'text') => (
    <input
      type={type}
      value={t[k]}
      onChange={(e) => { setT((p) => ({ ...p, [k]: e.target.value })); setSaved(false); }}
      placeholder={label}
      aria-label={label}
      className="w-full rounded-lg border border-edge bg-glass-w8 px-2.5 py-1.5 text-xs text-retro-fg placeholder:text-retro-muted focus:outline-none focus:border-retro-accent"
    />
  );

  return (
    <div className="p-4 bg-glass-w5 border border-edge rounded-lg space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xs font-medium uppercase tracking-wider text-retro-muted">TURN relay (cross-NAT)</span>
        {saved && <CheckCircle className="w-4 h-4 text-success-fg" />}
      </div>
      <p className="text-xs text-retro-body">
        If a friend behind a strict NAT cannot connect, add a TURN relay you run (or a free one). It relays the
        connection so two closed networks can still play. Leave blank for STUN-only.
      </p>
      <div className="space-y-1.5">
        {field('url', 'turn:host:3478')}
        {field('username', 'username')}
        {field('credential', 'credential', 'password')}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} className="rounded-md border border-edge bg-glass-w8 px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-glass-w12 cursor-pointer">
          Save relay
        </button>
        <button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded-md border border-edge bg-glass-w8 px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-glass-w12 cursor-pointer">
          <Trash className="w-3.5 h-3.5" /> Clear
        </button>
      </div>
    </div>
  );
}