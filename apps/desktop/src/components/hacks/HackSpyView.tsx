"use client";

import { useState, useEffect } from 'react';
import { Flame, ShieldAlert, ArrowLeft, Clock, MessageSquare, Image as ImageIcon, Heart } from 'lucide-react';
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

  // The server only answers while OUR session on this target is active —
  // a stale/expired one gets a 403 and the view says so plainly.
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
          if (!cancelled) {
            setFeedError(
              res.status === 403
                ? 'Your session ended — buy another to keep looking.'
                : 'Connection dropped — retrying…',
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
        if (!cancelled) setFeedError('Could not load — retrying…');
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
    <div className="relative w-full h-full flex flex-col font-sans select-none overflow-hidden bg-surface-canvas text-retro-fg">
      {flashWhite && (
        <div className="fixed inset-0 z-[99999] bg-glass-w20 pointer-events-none" />
      )}

      {/* Session header */}
      <div className="relative z-30 flex items-center justify-between px-4 py-3 bg-retro-panel border-b border-border-glass shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { playPress(750); onBack(); }}
            className="px-2.5 py-1 rounded-xl bg-surface-interactive hover:border-retro-accent/40 text-retro-fg flex items-center gap-1.5 text-xs font-bold transition-colors cursor-pointer border border-border-glass"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${feedError ? 'bg-zinc-500' : 'bg-retro-online'}`} />
            <span className="text-xs font-bold tracking-wide text-retro-fg flex items-center gap-1.5">
              <IconComponent className="w-3.5 h-3.5 inline text-retro-accent" />
              <span>{feed?.target?.display_name || session.targetUserName}</span>
            </span>
          </div>
        </div>

        <div className={`flex items-center gap-2 px-3 py-1 rounded-xl border text-xs font-mono font-bold tabular-nums ${
          secondsRemaining < 30 ? 'bg-red-950/40 border-red-500/40 text-red-300' : 'bg-surface-interactive border-border-glass text-retro-fg'
        }`}>
          <Clock className="w-3.5 h-3.5" />
          <span>{formatTimer(secondsRemaining)}</span>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 styled-scrollbar">
        <div className="glass-surface border border-border-glass rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-border-glass pb-3">
            <div>
              <span className="text-[10px] font-mono text-retro-muted uppercase tracking-wider">In session</span>
              <h2 className="text-base font-bold text-retro-fg">{session.itemName}</h2>
            </div>
            <span className={`px-3 py-1 rounded-full font-mono text-[10px] font-bold tracking-wider border ${
              feedError
                ? 'bg-zinc-500/10 border-zinc-600 text-zinc-400'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            }`}>
              {feedError ? 'OFFLINE' : 'LIVE'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="bg-black/40 p-3.5 rounded-2xl border border-border-glass space-y-1">
              <span className="text-retro-muted block text-[10px] uppercase font-bold">Player</span>
              <p className="text-retro-fg font-bold truncate">{feed?.target?.display_name || session.targetUserName}</p>
              {feed?.target?.bio ? (
                <p className="text-[10px] text-retro-body italic mt-1 line-clamp-2">&quot;{feed.target.bio}&quot;</p>
              ) : null}
            </div>

            <div className="bg-black/40 p-3.5 rounded-2xl border border-border-glass space-y-1">
              <span className="text-retro-muted block text-[10px] uppercase font-bold">Session</span>
              <p className={feedError ? 'text-amber-300 font-bold' : 'text-emerald-300 font-bold'}>
                {feedError || 'Live'}
              </p>
              <p className="text-[10px] text-retro-muted">Their posts and recent messages are visible while the timer runs</p>
            </div>
          </div>
        </div>

        {/* Recent messages (real, server-gated) */}
        <div className="glass-surface border border-border-glass rounded-3xl p-5 space-y-4 shadow-2xl">
          <div className="flex items-center gap-2 text-xs font-bold text-retro-fg tracking-wide">
            <MessageSquare className="w-4 h-4 text-retro-muted" />
            <span>Recent messages</span>
          </div>

          {feed && feed.intercepted.length > 0 ? (
            <div className="space-y-3 text-xs">
              {feed.intercepted.map((m, i) => (
                <div key={`${m.created_at}-${i}`} className="p-3 rounded-2xl bg-black/40 border border-border-glass space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-retro-muted">
                    <span className="font-bold text-retro-fg">{feed.target.display_name}</span>
                    <span>{timeAgo(m.created_at)}</span>
                  </div>
                  <p className="text-retro-body break-words">&quot;{m.body}&quot;</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-retro-muted">
              {feed ? 'Nothing new from them right now.' : 'Loading…'}
            </p>
          )}
        </div>

        {/* Their posts (real) */}
        <div className="glass-surface border border-border-glass rounded-3xl p-5 space-y-4 shadow-2xl">
          <div className="flex items-center gap-2 text-xs font-bold text-retro-fg tracking-wide">
            <ImageIcon className="w-4 h-4 text-retro-muted" />
            <span>Their posts</span>
          </div>

          {feed && feed.posts.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {feed.posts.map((p) => (
                <div key={p.id} className="p-3 rounded-2xl bg-black/40 border border-border-glass space-y-1">
                  <p className="text-xs text-retro-body line-clamp-2 break-words">
                    {p.caption || <span className="text-retro-muted italic">(no caption)</span>}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-retro-muted">
                    <span className="inline-flex items-center gap-1">
                      <Heart className="w-3 h-3" /> {p.likes}
                    </span>
                    <span>{timeAgo(p.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-retro-muted">
              {feed ? 'They have nothing posted yet.' : 'Loading…'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
