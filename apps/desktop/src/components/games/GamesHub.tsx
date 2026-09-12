"use client";

import { useEffect, useRef, useState } from 'react';
import { playPress } from '../../utils/sounds';
import { BabecockPanel } from '../BabecockPanel';
import { RankingsPanel } from './RankingsPanel';
import GridWorkspace from '../grid/GridWorkspace';
import type { OrbitIdentity } from '@orbit/crypto';
import type { User } from '@orbit/shared';

type GamesTab = 'duel' | 'babecock' | 'ranks' | 'idle';

export function GamesHub({
  identity,
  users = [],
  onSelectUser,
  subTab,
  onSubTabChange,
  renderDuelContent,
  onOpenSources,
}: {
  identity: OrbitIdentity | null;
  users?: User[];
  onSelectUser?: (userId: string) => void;
  subTab: GamesTab;
  onSubTabChange?: (tab: GamesTab) => void;
  renderDuelContent: () => React.ReactNode;
  /** Open the custom image-sources manager (idle clicker). */
  onOpenSources?: () => void;
}) {

  // Idle Clicker fullscreen: Fullscreen API on the workspace box, with an
  // in-app expanded fallback (some hosts deny the request).
  const idleBoxRef = useRef<HTMLDivElement>(null);
  const [idleFullscreen, setIdleFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => setIdleFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleIdleFullscreen = () => {
    playPress(800);
    const el = idleBoxRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => setIdleFullscreen((v) => !v));
    } else if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => setIdleFullscreen((v) => !v));
    } else {
      setIdleFullscreen((v) => !v);
    }
  };

  return (
    <div className={`w-full flex flex-col font-sans select-none ${subTab === 'idle' ? 'pb-0 flex-1 min-h-0 h-full max-w-none mx-0' : 'pb-24 max-w-6xl mx-auto'} text-retro-fg animate-orbit-fade-in`}>
      {/* Sleek Arena Mode Pills */}
      {subTab !== 'idle' && (
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 pt-3 pb-1">
          <div className="flex items-center gap-1 p-1 rounded-full bg-retro-panel border border-border-glass" role="tablist" aria-label="Arena Modes">
            {[
              { id: 'duel' as const, label: '1v1 Arena' },
              { id: 'ranks' as const, label: 'Rankings' },
              { id: 'babecock' as const, label: 'Babecock' },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  playPress(780);
                  onSubTabChange?.(mode.id);
                }}
                aria-pressed={subTab === mode.id}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  subTab === mode.id
                    ? 'bg-retro-accent text-retro-accent-text '
                    : 'text-retro-muted hover:text-retro-fg'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className={subTab === 'idle' ? 'p-1 sm:p-2 flex-1 min-h-0 h-full w-full flex flex-col overflow-hidden' : 'p-3 sm:p-4'}>
        {subTab === 'duel' && (
          <div className="space-y-4">
            {renderDuelContent()}
          </div>
        )}

        {subTab === 'babecock' && (
          <div className="glass-surface rounded-lg p-4">
            <BabecockPanel identity={identity} />
          </div>
        )}

        {/* Idle Clicker — fills the content column; entry is the sidebar. */}
        {subTab === 'idle' && (
          <div
            ref={idleBoxRef}
            className={`relative min-h-0 flex-1 w-full rounded-lg overflow-hidden bg-surface-canvas p-1 sm:p-2 flex flex-col ${idleFullscreen ? 'h-dvh' : 'h-[calc(100dvh-72px)] min-h-[580px]'}`}
          >
            <GridWorkspace
              idleFullscreen={idleFullscreen}
              onToggleFullscreen={toggleIdleFullscreen}
              onOpenSources={onOpenSources}
            />
          </div>
        )}

        {subTab === 'ranks' && (
          <RankingsPanel
            users={users}
            onSelectUser={(uId) => onSelectUser?.(uId)}
          />
        )}
      </div>
    </div>
  );
}
