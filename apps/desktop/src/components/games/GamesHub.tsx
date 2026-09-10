"use client";

import { useEffect, useRef, useState } from 'react';
import { playPress } from '../../utils/sounds';
import { Maximize, Minimize2, Images } from 'lucide-react';
import { BabecockPanel } from '../BabecockPanel';
import { RankingsPanel } from './RankingsPanel';
import { DeckBuilder } from './DeckBuilder';
import { CardTile } from '../home/CardTile';
import { openCardDetail } from '../../utils/openCard';
import GridWorkspace from '../grid/GridWorkspace';
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject as StoredCard, User } from '@orbit/shared';

type GamesTab = 'duel' | 'cards' | 'babecock' | 'ranks' | 'idle';

export function GamesHub({
  identity,
  cards,
  users = [],
  onSelectUser,
  initialSubTab = 'idle',
  renderDuelContent,
  toast,
  onOpenSources,
}: {
  identity: OrbitIdentity | null;
  cards: StoredCard[];
  users?: User[];
  onSelectUser?: (userId: string) => void;
  initialSubTab?: GamesTab | 'store';
  renderDuelContent: () => React.ReactNode;
  onOpenStore?: () => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  /** Open the custom image-sources manager (idle clicker). */
  onOpenSources?: () => void;
}) {
  const initial = (initialSubTab === 'store' ? 'idle' : initialSubTab) as GamesTab;
  const [subTab, setSubTab] = useState<GamesTab>(initial);

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
    <div className={`w-full max-w-6xl mx-auto flex flex-col font-sans select-none ${subTab === 'idle' ? 'pb-2' : 'pb-24'} text-retro-fg animate-orbit-fade-in`}>
      {/* Tab bar removed — every game is reachable from the sidebar. */}
      {/* Content */}
      <div className={subTab === 'idle' ? 'p-2' : 'p-3 sm:p-4'}>
        {subTab === 'duel' && (
          <div className="space-y-4">
            {renderDuelContent()}
          </div>
        )}

        {subTab === 'cards' && (
          <div className="space-y-4">
            <div className="glass-surface rounded-lg p-4">
              {cards.length === 0 ? (
                <p className="text-xs text-retro-muted text-center py-8">No cards yet — battle in the arena or upload to your collection.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {cards.slice(0, 24).map((card) => (
                    <div
                      key={card.id}
                      className="cursor-grab active:cursor-grabbing"
                      draggable
                      title="Drag into the deck editor to add"
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-gmatch-card', JSON.stringify({ cardId: (card as any).card_id || card.id }));
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                    >
                      <CardTile item={card as any} users={users} identity={identity} onClick={() => openCardDetail(card)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Deck (Games -> Cards -> Deck): collection manager lives inside Cards */}
            <div className="glass-surface rounded-lg p-4">
              <h3 className="text-xs font-bold text-retro-fg uppercase tracking-wider mb-3">Deck</h3>
              <DeckBuilder
                identity={identity}
                cards={cards}
                onEnterArena={() => setSubTab('duel')}
                toast={toast}
              />
            </div>
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
            className={`relative rounded-lg overflow-hidden bg-surface-canvas ${idleFullscreen ? 'h-dvh p-4' : 'h-[calc(100dvh-160px)] min-h-[520px]'}`}
          >
            <div className="absolute right-2 top-2 z-20 flex items-center gap-1.5">
              {onOpenSources && (
                <button
                  type="button"
                  onClick={() => { playPress(700); onOpenSources(); }}
                  title="Custom image sources — add your own URLs or folders"
                  aria-label="Custom image sources"
                  className="p-1.5 rounded-md bg-black/50 text-retro-muted hover:text-retro-fg hover:bg-black/70 transition-colors cursor-pointer"
                >
                  <Images className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={toggleIdleFullscreen}
                title={idleFullscreen ? 'Exit fullscreen' : 'Play fullscreen'}
                aria-label={idleFullscreen ? 'Exit fullscreen' : 'Play fullscreen'}
                aria-pressed={idleFullscreen}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${idleFullscreen ? 'bg-retro-accent/20 text-retro-accent' : 'bg-black/50 text-retro-muted hover:text-retro-fg hover:bg-black/70'}`}
              >
                {idleFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
            <GridWorkspace />
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
