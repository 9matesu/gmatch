"use client";

import { X, Sparkles, Coins } from 'lucide-react';

export function PointsHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[var(--z-system)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-border-glass rounded-lg max-w-lg w-full max-h-[85vh] flex flex-col shadow-xl overflow-hidden text-retro-fg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass">
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
          {/* The app has five different quantities called "points". Conflating
              them is the single biggest source of "my points are wrong": this
              table used to label SCORE as g$, so winning a duel (which pays
              0 g$ and 50 score) looked like a broken wallet. */}
          <section className="space-y-2">
            <h3 className="font-medium text-retro-fg text-xs">Three different currencies</h3>
            <div className="bg-surface-interactive border border-border-glass rounded-lg p-3 space-y-2 text-retro-muted leading-relaxed">
              <p>
                <strong className="text-retro-fg">g$</strong> — your wallet. Earned by
                selling cards, cashing out your collection, and PC Domination cuts. Spent
                in the Store and on match boosts. This is the number in the top bar.
              </p>
              <p>
                <strong className="text-retro-fg">Score</strong> — today's activity. Reset
                every day at 00:00 UTC. Feeds the Rankings "Today" board.
              </p>
              <p>
                <strong className="text-retro-fg">Reputation</strong> — your all-time
                score. Never resets. Feeds the Rankings "XP" board.
              </p>
              <p>
                <strong className="text-retro-fg">Clicker points</strong> — a separate,
                local-only counter in the idle game. It never touches your wallet and
                resets when you prestige.
              </p>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-retro-fg text-xs flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-retro-online" />
              <span>Earning g$</span>
            </h3>
            <div className="bg-surface-interactive border border-border-glass rounded-lg p-3 space-y-1.5">
              {[
                ['Cash out a card', 'set by card rarity'],
                ['Sell a card on the market', 'set by the buyer'],
                ['PC Domination cut (as victim)', '+25 g$'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-xs py-0.5 gap-3">
                  <span className="text-retro-body">{label}</span>
                  <span className="font-medium font-mono text-retro-online tabular-nums text-right">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-retro-fg text-xs flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-retro-accent" />
              <span>Earning score (not g$)</span>
            </h3>
            <div className="bg-surface-interactive border border-border-glass rounded-lg p-3 space-y-1.5">
              {[
                ['Win a tier duel', '+50 score'],
                ['Draw a tier duel', '+10 score'],
                ['Lose a tier duel', '+5 score'],
                ['Advance a special tier', '+25 score'],
                ['Win a special match', '+200 score'],
                ['Post a story', '+10 score'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-xs py-0.5 gap-3">
                  <span className="text-retro-body">{label}</span>
                  <span className="font-medium font-mono text-retro-accent tabular-nums text-right">{value}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-retro-muted leading-relaxed">
              Duels pay score, not g$. The g$ side of a tier duel scales with the rarity
              of both cards (a common-vs-common win is 50 g$; diamond-vs-diamond is
              1,250 g$), so there is no single flat amount to quote here. Single likes
              earn nothing in either currency — only mutual matches and duel results do.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-rose-400 text-xs">
              Store spending
            </h3>
            <div className="bg-surface-interactive border border-border-glass rounded-lg p-3 space-y-1.5">
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

          <p className="text-xs text-retro-muted leading-relaxed text-center pt-1">
            g$ are in-game currency. They cannot be purchased with real money.
          </p>
        </div>
      </div>
    </div>
  );
}
