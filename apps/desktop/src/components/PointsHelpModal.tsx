"use client";

import { X, Sparkles, Coins } from 'lucide-react';

export function PointsHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-retro-border rounded-lg max-w-lg w-full max-h-[85vh] flex flex-col shadow-xl overflow-hidden text-retro-fg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-retro-border">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-retro-accent" />
            <h2 className="text-sm font-medium text-retro-fg">How g$ works</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-retro-muted hover:text-retro-fg p-1 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs styled-scrollbar">
          <section className="space-y-2">
            <h3 className="font-medium text-retro-fg text-xs flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-retro-online" />
              <span>Earning g$</span>
            </h3>
            <div className="bg-surface-interactive border border-retro-border rounded-lg p-3 space-y-1.5">
              {[
                ['Mutual like in a match', '+50 g$ each'],
                ['League match win', '+50 g$'],
                ['League match draw', '+10 g$'],
                ['League match loss', '+5 g$'],
                ['Post a story', '+10 g$'],
                ['Tier advance', '+25 g$'],
                ['Special match champion', '+200 g$'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-xs py-0.5">
                  <span className="text-retro-body">{label}</span>
                  <span className="font-medium font-mono text-retro-online tabular-nums">{value}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-retro-muted leading-relaxed">
              Single likes earn no g$ — only mutual matches and duel results reward points.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-rose-400 text-xs">
              Store spending
            </h3>
            <div className="bg-surface-interactive border border-retro-border rounded-lg p-3 space-y-1.5">
              {[
                ['Vision Jam', '\u2212800 g$'],
                ['Flash Drop', '\u22121,000 g$'],
                ['Screen Lock', '\u22124,500 g$'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-xs py-0.5">
                  <span className="text-retro-body">{label}</span>
                  <span className="font-medium font-mono text-rose-400 tabular-nums">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <p className="text-[11px] text-retro-muted leading-relaxed text-center pt-1">
            g$ are in-game currency. They cannot be purchased with real money.
          </p>
        </div>
      </div>
    </div>
  );
}
