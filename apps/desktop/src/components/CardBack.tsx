"use client";

import { Sparkles, Clock } from 'lucide-react'

interface CardBackProps {
  label?: string
  className?: string
  ticking?: boolean
}

/**
 * Premium card-back used wherever an opponent (or spectator) card is hidden or being picked.
 * Features an animated ticking holographic glow when cards are being chosen.
 */
export function CardBack({ label, className = '', ticking = false }: CardBackProps) {
  const isTicking = ticking || (label && (label.toLowerCase().includes('picking') || label.toLowerCase().includes('choosing') || label.toLowerCase().includes('waiting')))

  return (
    <div className={`relative w-full h-full flex flex-col items-center justify-center gap-2 overflow-hidden bg-surface-canvas select-none ${className}`}>
      {/* Background Grid Pattern */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, rgba(168, 85, 247, 0.15) 0%, transparent 70%), repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 4px)',
        }}
      />

      {/* Pulsing Border Glow during ticking / picking */}
      <div className={`absolute inset-1.5 border-2 rounded-xl pointer-events-none transition duration-700 ${
        isTicking
          ? 'border-chrome-lav/0 animate-pulse'
          : 'border-edge'
      }`} />
      
      <div className="absolute inset-3 border border-edge rounded-lg pointer-events-none" />

      {/* Shimmer Scanline */}
      {isTicking && (
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-500/10 to-transparent animate-orbit-scan pointer-events-none" />
      )}

      {/* Center Icon & Holographic Symbol */}
      <div className="relative flex flex-col items-center justify-center gap-1.5 z-10">
        <div className={`w-10 h-10 rounded-xl bg-surface-canvas border border-edge flex items-center justify-center shadow-lg transition-transform ${
          isTicking ? 'scale-105 border-chrome-lav/0 text-info-fg animate-bounce' : 'text-retro-muted'
        }`}>
          {isTicking ? <Clock className="w-5 h-5 animate-spin" style={{ animationDuration: '4s' }} /> : <Sparkles className="w-5 h-5" />}
        </div>

        {label && (
          <span className={`text-2xs font-bold tracking-wider uppercase text-center px-2 py-0.5 rounded-md ${
            isTicking ? 'text-info-fg bg-chrome-lav/0 border border-chrome-lav/0 animate-pulse' : 'text-retro-muted'
          }`}>
            {label}
          </span>
        )}
      </div>
    </div>
  )
}
