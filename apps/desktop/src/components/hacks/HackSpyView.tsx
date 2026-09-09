"use client";

import { useState, useEffect } from 'react';
import { Flame, ShieldAlert, ArrowLeft, Clock, MessageSquare, Image as ImageIcon } from 'lucide-react';
import { playPress, playMatchFound } from '../../utils/sounds';
import { orbitFetch } from '../../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import type { ActiveHackSession } from '../home/HomeFooter';

interface HackSpyViewProps {
  session: ActiveHackSession;
  identity: OrbitIdentity | null;
  onBack: () => void;
  onExpire: () => void;
}

interface SpyPost {
  id: string;
  caption: string;
  likes: number;
  created_at: string;
}
interface SpyPeek {
  body: string;
  created_at: string;
}
interface SpyFeed {
  hack: { type: string; expires_at: number };
  target: { id: string; display_name: string; bio: string };
  posts: SpyPost[];
  intercepted: SpyPeek[];
}

const HACK_ICONS = { mobile: Flame, default: ShieldAlert };

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function HackSpyView({ session, identity, onBack, onExpire }: HackSpyViewProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    return Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  });
  const [flashWhite, setFlashWhite] = useState(true);
  const [feed, setFeed] = useState<SpyFeed | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);

  useEffect(() => {
    // Initial white flash transition
    playMatchFound();
    const flashTimer = setTimeout(() => {
      setFlashWhite(false);
    }, 280);
    return () => clearTimeout(flashTimer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const rem = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
      setSecondsRemaining(rem);
      if (rem <= 0) {
        clearInterval(timer);
        onExpire();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [session.expiresAt, onExpire]);

  // Real intercept: the server only answers while OUR hack on this target is
  // active — a stale/expired session gets a 403 and the view says so.
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await orbitFetch(
          `/api/users/hacks/spy-feed/${session.targetUserId}`,
          {},
          identity,
        );
        if (!res.ok) {
          // Errors name the recovery: 403 means the hack lapsed (buy another);
          // anything else keeps retrying on the 15s poll, so say that.
          if (!cancelled) {
            setFeedError(
              res.status === 403
                ? 'Hack expired — buy another to resume the intercept'
                : 'Link severed — retrying automatically…',
            )
          }
          return;
        }
        const data = (await res.json()) as SpyFeed;
        if (!cancelled) {
          setFeed(data);
          setFeedError(null);
        }
      } catch {
        if (!cancelled) setFeedError('Intercept failed — retrying automatically…');
      }
    };
    void load();
    const poll = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [identity, session.targetUserId]);

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  const iconKey = session.itemId.includes('mobile') ? 'mobile' : 'default';
  const IconComponent = HACK_ICONS[iconKey];

  return (
    <div className="relative w-full h-full flex flex-col font-sans select-none overflow-hidden bg-surface-canvas text-white">
      {/* Rapid White Flash Overlay */}
      {flashWhite && (
        <div className="fixed inset-0 z-[99999] bg-surface-raised transition-opacity duration-300 pointer-events-none opacity-100 animate-out fade-out" />
      )}

      {/* Red Inner Shadow Vignette Overlay */}
      <div className="pointer-events-none absolute inset-0 z-20 shadow-[inset_0_0_80px_rgba(239,68,68,0.7)] sm:shadow-[inset_0_0_120px_rgba(239,68,68,0.8)] border border-red-500/30" />

      {/* Top Hack HUD Bar */}
      <div className="relative z-30 flex items-center justify-between px-4 py-3 bg-red-950/80 backdrop-blur-md border-b border-red-500/40 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { playPress(750); onBack(); }}
            className="px-2.5 py-1 rounded-xl bg-red-900/60 hover:bg-red-800 text-red-100 flex items-center gap-1.5 text-xs font-bold transition-colors cursor-pointer border border-red-500/50"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return</span>
          </button>

          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
            <span className="text-xs font-black tracking-widest uppercase text-red-400 flex items-center gap-1">
              <IconComponent className="w-3.5 h-3.5 inline text-red-400" />
              <span>SPY FEED: {feed?.target?.display_name || session.targetUserName}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-red-900/80 px-3 py-1 rounded-xl border border-red-500 text-xs font-mono font-black text-red-200">
          <Clock className="w-3.5 h-3.5 text-red-400" />
          <span>{formatTimer(secondsRemaining)}</span>
        </div>
      </div>

      {/* Main Infiltrated Content Area */}
      <div className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 styled-scrollbar">
        {/* Hacker Intercept Header Card */}
        <div className="bg-surface-canvas/90 border border-red-500/40 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-red-900/50 pb-3">
            <div>
              <span className="text-[10px] font-mono font-bold text-red-400 uppercase tracking-widest">Active Penetration Payload</span>
              <h2 className="text-base font-black text-white">{session.itemName}</h2>
            </div>
            <span className={`px-3 py-1 rounded-full font-mono text-xs font-black tracking-wider border ${feedError ? 'bg-zinc-500/20 border-zinc-500 text-zinc-400' : 'bg-red-500/20 border-red-500 text-red-400'}`}>
              {feedError ? 'LINK LOST' : 'TARGET PWNED'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
            <div className="bg-black/60 p-3.5 rounded-2xl border border-red-900/40 space-y-1">
              <span className="text-retro-muted block text-[10px] uppercase font-bold">Target Identity:</span>
              <p className="text-red-300 font-bold truncate">{feed?.target?.display_name || session.targetUserName}</p>
              <p className="text-[10px] text-retro-muted font-mono">{session.targetUserId}</p>
              {feed?.target?.bio ? (
                <p className="text-[10px] text-retro-body italic mt-1 line-clamp-2">&quot;{feed.target.bio}&quot;</p>
              ) : null}
            </div>

            <div className="bg-black/60 p-3.5 rounded-2xl border border-red-900/40 space-y-1">
              <span className="text-retro-muted block text-[10px] uppercase font-bold">Infiltration Status:</span>
              <p className={feedError ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>
                {feedError || 'STREAM SYNCHRONIZED'}
              </p>
              <p className="text-[10px] text-retro-muted">Full read &amp; spy stream unlocked</p>
            </div>
          </div>
        </div>

        {/* Intercepted DMs (real, server-gated) */}
        <div className="bg-surface-canvas/90 border border-red-500/40 rounded-3xl p-5 space-y-4 shadow-2xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase text-red-400 tracking-wider">
            <MessageSquare className="w-4 h-4" />
            <span>Intercepted Direct Messages</span>
          </div>

          {feed && feed.intercepted.length > 0 ? (
            <div className="space-y-3 font-mono text-xs">
              {feed.intercepted.map((m, i) => (
                <div key={`${m.created_at}-${i}`} className="p-3 rounded-2xl bg-black/60 border border-zinc-800 space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-retro-muted">
                    <span className="font-bold text-red-400">{feed.target.display_name}</span>
                    <span>{timeAgo(m.created_at)}</span>
                  </div>
                  <p className="text-retro-body break-words">&quot;{m.body}&quot;</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-retro-muted font-mono">
              {feed ? 'No traffic on the wire — target is quiet.' : 'Decrypting packet capture…'}
            </p>
          )}
        </div>

        {/* Stolen post feed (real) */}
        <div className="bg-surface-canvas/90 border border-red-500/40 rounded-3xl p-5 space-y-4 shadow-2xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase text-red-400 tracking-wider">
            <ImageIcon className="w-4 h-4" />
            <span>Exfiltrated Posts</span>
          </div>

          {feed && feed.posts.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {feed.posts.map((p) => (
                <div key={p.id} className="p-3 rounded-2xl bg-black/60 border border-zinc-800 space-y-1">
                  <p className="text-xs text-retro-body line-clamp-2 break-words">
                    {p.caption || <span className="text-retro-muted italic">(no caption)</span>}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-retro-muted font-mono">
                    <span>♥ {p.likes}</span>
                    <span>{timeAgo(p.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-retro-muted font-mono">
              {feed ? 'Target has nothing public on the board.' : 'Scraping target uploads…'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
