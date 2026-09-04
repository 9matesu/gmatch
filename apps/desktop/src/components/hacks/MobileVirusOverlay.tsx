"use client";

import { useState, useEffect } from 'react';
import { ShieldAlert, Terminal } from 'lucide-react';
import type { OrbitObject as CardItem } from '@orbit/shared';

const SAMPLE_VIRUS_IMAGES = [
  'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=800&q=80',
];

export function MobileVirusOverlay({
  cards = [],
  attackerName = 'Anonymous Hacker',
  onComplete,
}: {
  cards?: CardItem[];
  attackerName?: string;
  onComplete?: () => void;
}) {
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const images = cards.length > 0
    ? cards.map((c) => c.content_url || (c as any).url || (c as any).data).filter(Boolean)
    : SAMPLE_VIRUS_IMAGES;

  // Ultra-fast slideshow tick (every 140ms)
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveImageIndex((prev) => (prev + 1) % images.length);
    }, 140);
    return () => clearInterval(interval);
  }, [images.length]);

  // Countdown 60 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onComplete?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-between p-4 select-none overflow-hidden font-mono pointer-events-auto cursor-not-allowed">
      {/* Glitch Overlay Banner */}
      <div className="w-full z-20 bg-red-600/90 text-white p-3 rounded-2xl border-2 border-red-400 shadow-2xl flex items-center justify-between animate-pulse">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 animate-bounce text-yellow-300" />
          <div>
            <h1 className="text-xs sm:text-sm font-black uppercase tracking-wider">
              CYBER VIRUS TAKEOVER ACTIVE
            </h1>
            <p className="text-[10px] text-yellow-200">
              Launched by <strong>@{attackerName}</strong> via Store Exploit
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-xs font-bold text-red-200 block">LOCK EXPIRES IN</span>
          <span className="text-xl font-black text-yellow-300">{secondsRemaining}s</span>
        </div>
      </div>

      {/* Rapid Image Centerpiece */}
      <div className="relative w-full max-w-md aspect-square rounded-3xl overflow-hidden border-4 border-red-500 shadow-2xl z-10 filter contrast-125 saturate-150">
        <img
          src={images[activeImageIndex] || SAMPLE_VIRUS_IMAGES[0]}
          alt=""
          className="w-full h-full object-cover animate-spin-slow"
        />

        {/* Matrix Scanlines & Glitch Overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-red-500/20 to-transparent pointer-events-none animate-pulse" />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-4xl sm:text-5xl font-black text-red-500/80 drop-shadow-lg tracking-widest uppercase rotate-[-12deg]">
            VIRUS LOCK
          </span>
        </div>
      </div>

      {/* Hacker Terminal Logs */}
      <div className="w-full max-w-md bg-surface-canvas/90 border border-red-500/50 p-3 rounded-2xl text-[10px] text-green-400 z-20 space-y-1 backdrop-blur-md">
        <div className="flex items-center gap-1.5 text-red-400 font-bold border-b border-red-900/50 pb-1">
          <Terminal className="w-3.5 h-3.5" />
          <span>SYSTEM CORRUPTION PAYLOAD</span>
        </div>
        <p className="truncate">&gt; INJECTING MEMORY LEAK: 0x8FA492B...</p>
        <p className="truncate">&gt; HIJACKING DISPLAY PROTOCOL BUFFER...</p>
        <p className="truncate text-yellow-400">&gt; USER NAVIGATION DISABLED FOR {secondsRemaining} SECONDS</p>
      </div>
    </div>
  );
}
