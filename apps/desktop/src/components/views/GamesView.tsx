"use client";

// Extracted verbatim from App.tsx `mainView === 'games'` branch: the GamesHub
// wrapper plus the `renderDuelContent` closure that renders LobbyPanel.
// All state setters/callbacks are threaded as explicit props; no logic changed.
import { useState } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject, User } from '@orbit/shared';
import type { useLobby } from '../../hooks/useLobby';
import { GamesHub } from '../games/GamesHub';
import { LobbyPanel } from '../LobbyPanel';
import CustomSourcesModal from '../grid/CustomSourcesModal';
import type { MainViewType } from '../home/HomeFooter';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
type GamesSubTab = 'duel' | 'cards' | 'babecock' | 'ranks' | 'store' | 'idle';

export function GamesView({
  gamesSubTab,
  identity,
  myCards,
  users,
  lobby,
  toggleAutoQueue,
  sendInvite,
  soundEnabled,
  toast,
  setSelectedProfileUser,
  setLobbyLightboxUrl,
  setExpandedItemId,
  setShowHelpModal,
  setPmPeer,
  setDmMinimized,
  setMainView,
  setSpectateViewerItems,
  openCreateCardModal,
  navigateToDeckBuilder,
  handleSetMainView,
}: {
  gamesSubTab: GamesSubTab;
  identity: OrbitIdentity | null;
  myCards: OrbitObject[];
  users: User[];
  lobby: ReturnType<typeof useLobby>;
  toggleAutoQueue: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  sendInvite: (userId: string) => Promise<{ ok: boolean; error?: string }>;
  soundEnabled: boolean;
  toast: ToastFn;
  setSelectedProfileUser: (user: User) => void;
  setLobbyLightboxUrl: (url: string | null) => void;
  setExpandedItemId: (id: string | null) => void;
  setShowHelpModal: (v: boolean) => void;
  setPmPeer: React.Dispatch<React.SetStateAction<User | null>>;
  setDmMinimized: (v: boolean) => void;
  setMainView: React.Dispatch<React.SetStateAction<MainViewType>>;
  setSpectateViewerItems: (items: OrbitObject[] | null) => void;
  openCreateCardModal: () => void;
  navigateToDeckBuilder: () => void;
  handleSetMainView: (view: MainViewType) => void;
}) {
  const [showSources, setShowSources] = useState(false);
  return (
    <>
    <GamesHub
      key={`games-${gamesSubTab}`}
      identity={identity}
      cards={myCards as any}
      users={users}
      onSelectUser={(uId) => {
        const target = users.find((u) => u.id === uId || (u as any).orbitId === uId);
        if (target) setSelectedProfileUser(target);
      }}
      initialSubTab={gamesSubTab}
      renderDuelContent={() => (
        <LobbyPanel
          lobby={lobby}
          toggleAutoQueue={toggleAutoQueue}
          sendInvite={sendInvite}
          identity={identity}
          myCards={myCards}
          soundEnabled={soundEnabled}
          onOpenImage={(url) => setLobbyLightboxUrl(url)}
          onExpandItem={(id) => setExpandedItemId(id)}
          onOpenHelp={() => setShowHelpModal(true)}
          onOpenProfile={(user) => setSelectedProfileUser(user)}
          onOpenCardChat={() => {
            setPmPeer({ id: 'card_queue', display_name: 'Card Game Queue' } as any)
            setDmMinimized(false)
            setMainView('messages')
          }}
          onOpenCreateCard={openCreateCardModal}
          onOpenDeckBuilder={navigateToDeckBuilder}
          onOpenSpectateItem={(items, initialId) => {
            setSpectateViewerItems(items);
            setExpandedItemId(initialId);
          }}
          users={users}
        />
      )}
      onOpenStore={() => handleSetMainView('store')}
      onOpenSources={() => setShowSources(true)}
      toast={toast}
    />
    {showSources && <CustomSourcesModal onClose={() => setShowSources(false)} />}
    </>
  );
}
