"use client";

import { useState } from 'react';
import { playPress } from '../../utils/sounds';
import { Swords, Flame, Trophy, ShieldAlert, Layers, LayoutGrid } from 'lucide-react';
import { ModPatrolWidget } from '../feed/ModPatrolWidget';
import { BabecockPanel } from '../BabecockPanel';
import { Leaderboard } from '../Leaderboard';
import { DeckBuilder } from './DeckBuilder';
import { CardTile } from '../home/CardTile';
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject as StoredCard, User } from '@orbit/shared';

type GamesTab = 'duel' | 'cards' | 'decks' | 'babecock' | 'ranks' | 'patrol';

export function GamesHub({
  identity,
  myUser,
  cards,
  users = [],
  onSelectUser,
  initialSubTab = 'duel',
  renderDuelContent,
  onOpenCollection,
  toast,
}: {
  identity: OrbitIdentity | null;
  myUser: any;
  cards: StoredCard[];
  users?: User[];
  onSelectUser?: (userId: string) => void;
  initialSubTab?: GamesTab | 'store';
  renderDuelContent: () => React.ReactNode;
  onOpenStore?: () => void;
  onOpenCollection?: () => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const initial = (initialSubTab === 'store' ? 'duel' : initialSubTab) as GamesTab;
  const [subTab, setSubTab] = useState<GamesTab>(initial);

  const tabs: { id: GamesTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'duel', label: 'Play', icon: Swords },
    { id: 'cards', label: 'Cards', icon: Layers },
    { id: 'decks', label: 'Decks', icon: LayoutGrid },
    { id: 'babecock', label: 'Babecock', icon: Flame },
    { id: 'ranks', label: 'Rankings', icon: Trophy },
    { id: 'patrol', label: 'Patrol', icon: ShieldAlert },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col font-sans select-none pb-24 text-retro-fg animate-orbit-fade-in">
      {/* Header */}
      <div className="glass-toolbar border-0 border-b border-border-glass rounded-none px-3 sm:px-4 py-3 flex items-center justify-between gap-3 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-retro-fg">Porn Games</h1>
          <span className="text-xs text-retro-muted tabular-nums flex items-center gap-1">
            <span className="text-retro-accent">{(myUser?.balance ?? 0).toLocaleString()}</span> g$
          </span>
        </div>
        <button
          type="button"
          onClick={() => { playPress(800); onOpenCollection?.(); }}
          title="Open Card Collection"
          aria-label="Open Card Collection"
          className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg hover:bg-white/8 transition-colors cursor-pointer"
        >
          <Layers className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Navigation — Fully Colored Active Tabs */}
      <div className="glass-surface metro-rule px-3 sm:px-4 flex items-center gap-1.5 overflow-x-auto styled-scrollbar py-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                playPress(800);
                setSubTab(tab.id);
              }}
              className={`glass-tab py-2 px-3.5 font-medium text-xs flex items-center gap-1.5 whitespace-nowrap rounded-md transition-all cursor-pointer ${isActive
                  ? 'glass-tab-active'
                  : ''
                }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="p-3 sm:p-4">
        {subTab === 'duel' && (
          <div className="space-y-4">
            {renderDuelContent()}
          </div>
        )}

        {subTab === 'decks' && (
          <div className="glass-surface rounded-lg p-4">
            <DeckBuilder
              identity={identity}
              cards={cards}
              onEnterArena={() => setSubTab('duel')}
              toast={toast}
            />
          </div>
        )}

        {subTab === 'cards' && (
          <div className="glass-surface rounded-lg p-4">
            {cards.length === 0 ? (
              <p className="text-xs text-retro-muted text-center py-8">No cards yet — battle in the arena or upload to your collection.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 lg:gap-5">
                {cards.slice(0, 24).map((card) => (
                  <CardTile key={card.id} item={card as any} users={users} identity={identity} />
                ))}
              </div>
            )}
          </div>
        )}

        {subTab === 'babecock' && (
          <div className="glass-surface rounded-lg p-4">
            <BabecockPanel identity={identity} />
          </div>
        )}

        {subTab === 'patrol' && (
          <div className="space-y-3 max-w-xl mx-auto">
            <ModPatrolWidget onAddScore={(pts) => toast?.(`+${pts} points awarded`, 'success')} />
          </div>
        )}

        {subTab === 'ranks' && (
          <div className="glass-surface rounded-lg p-4">
            <Leaderboard users={users} onSelectUser={onSelectUser || (() => { })} />
          </div>
        )}
      </div>
    </div>
  );
}
