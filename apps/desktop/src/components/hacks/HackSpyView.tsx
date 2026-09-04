"use client";

import { useState, useEffect } from 'react';
import { Radio, Skull, Flame, ShieldAlert, ArrowLeft, Clock, MessageSquare } from 'lucide-react';
import { playPress, playMatchFound } from '../../utils/sounds';
import type { OrbitIdentity } from '@orbit/crypto';
import type { ActiveHackSession } from '../home/HomeFooter';

interface HackSpyViewProps {
  session: ActiveHackSession;
  identity: OrbitIdentity | null;
  onBack: () => void;
  onExpire: () => void;
}

const HACK_ICONS = { dms: Radio, takeover: Skull, mobile: Flame, default: ShieldAlert };

export function HackSpyView({ session, identity, onBack, onExpire }: HackSpyViewProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    return Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  });
  const [flashWhite, setFlashWhite] = useState(true);

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

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  const iconKey = session.itemId.includes('takeover')
      ? 'takeover'
      : session.itemId.includes('mobile')
        ? 'mobile'
        : 'default';
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
              <span>SPY FEED: {session.targetUserName}</span>
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
            <span className="px-3 py-1 rounded-full bg-red-500/20 border border-red-500 text-red-400 font-mono text-xs font-black tracking-wider">
              TARGET PWNED
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
            <div className="bg-black/60 p-3.5 rounded-2xl border border-red-900/40 space-y-1">
              <span className="text-retro-muted block text-[10px] uppercase font-bold">Target Identity:</span>
              <p className="text-red-300 font-bold truncate">{session.targetUserName}</p>
              <p className="text-[10px] text-retro-muted font-mono">{session.targetUserId}</p>
            </div>

            <div className="bg-black/60 p-3.5 rounded-2xl border border-red-900/40 space-y-1">
              <span className="text-retro-muted block text-[10px] uppercase font-bold">Infiltration Status:</span>
              <p className="text-emerald-400 font-bold">STREAM SYNCHRONIZED</p>
              <p className="text-[10px] text-retro-muted">Full read &amp; spy stream unlocked</p>
            </div>
          </div>
        </div>

        {/* Intercepted Chat Log Simulation */}
        <div className="bg-surface-canvas/90 border border-red-500/40 rounded-3xl p-5 space-y-4 shadow-2xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase text-red-400 tracking-wider">
            <MessageSquare className="w-4 h-4" />
            <span>Intercepted Direct Conversation Logs</span>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="p-3 rounded-2xl bg-black/60 border border-zinc-800 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-retro-muted">
                <span className="font-bold text-red-400">{session.targetUserName}</span>
                <span>Just now</span>
              </div>
              <p className="text-retro-body">&quot;Check out this high rarity card I just unlocked for the tournament match tonight!&quot;</p>
            </div>

            <div className="p-3 rounded-2xl bg-black/60 border border-zinc-800 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-retro-muted">
                <span className="font-bold text-purple-400">Peer Correspondent</span>
                <span>2m ago</span>
              </div>
              <p className="text-retro-body">&quot;Nice! Ready for 1v1 duel whenever you send the invite.&quot;</p>
            </div>

            <div className="p-3 rounded-2xl bg-black/60 border border-zinc-800 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-retro-muted">
                <span className="font-bold text-red-400">{session.targetUserName}</span>
                <span>5m ago</span>
              </div>
              <p className="text-retro-body">&quot;Locking in my secret deck strategies now.&quot;</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
