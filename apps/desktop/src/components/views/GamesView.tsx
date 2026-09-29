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
import type { MainViewType } from '../home/CommandIsland';
import { orbitFetch } from '../../utils/api';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
type GamesSubTab = 'duel' | 'babecock' | 'ranks' | 'idle';

export function GamesView({
  gamesSubTab,
  setGamesSubTab,
  identity,
  myCards,
  hasActiveDeck,
  users,
  profilePics,
  lobby,
  toggleAutoQueue,
  sendInvite,
  soundEnabled,
  toast,
  setSelectedProfileUser,  setLobbyLightboxUrl,
  setExpandedItemId,
  setPmPeer,
  setDmMinimized,
  setMainView,
  setSpectateViewerItems,
  openCreateCardModal,
  navigateToDeckBuilder,
  handleSetMainView: _handleSetMainView,
  onRepostImage,
  onAddToStory,
  onCreateCard,
  onSetWallpaper,
}: {
  gamesSubTab: GamesSubTab;
  setGamesSubTab: (tab: GamesSubTab) => void;
  identity: OrbitIdentity | null;
  myCards: OrbitObject[];
  hasActiveDeck: boolean;
  users: User[];
  profilePics?: Record<string, string>;
  lobby: ReturnType<typeof useLobby>;
  toggleAutoQueue: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  sendInvite: (userId: string) => Promise<{ ok: boolean; error?: string }>;
  soundEnabled: boolean;
  toast: ToastFn;
  setSelectedProfileUser: (user: User) => void;
  setLobbyLightboxUrl: (url: string | null) => void;
  setExpandedItemId: (id: string | null) => void;
  setPmPeer: React.Dispatch<React.SetStateAction<User | null>>;
  setDmMinimized: (v: boolean) => void;
  setMainView: React.Dispatch<React.SetStateAction<MainViewType>>;
  setSpectateViewerItems: (items: OrbitObject[] | null) => void;
  openCreateCardModal: () => void;
  navigateToDeckBuilder: () => void;
  handleSetMainView: (view: MainViewType) => void;
  onRepostImage?: (media: { url: string; tags: string[]; name?: string; kind?: 'video' | 'image'; mimeType?: string }) => void;
  onAddToStory?: (media: { url: string; tags: string[]; name?: string; kind?: 'video' | 'image'; mimeType?: string }) => void;
  onCreateCard?: (media: { url: string; tags: string[]; name: string }) => void;
  onSetWallpaper?: (url: string) => void;
}) {
  const [showSources, setShowSources] = useState(false);
  return (
    <>
    <GamesHub
      key={`games-${gamesSubTab}`}
      identity={identity}
      users={users}
      onSelectUser={(uId) => {
        const target = users.find((u) => u.id === uId);
        if (target) {
          setSelectedProfileUser(target);
          return;
        }
        // The directory is capped (100 rows server-side, then a 24h stale
        // filter), so a ranked player can be absent from `users`. This used to
        // be a silent no-op — the click looked broken. Fetch the one row.
        if (!identity) {
          toast('Could not load that player', 'error');
          return;
        }
        void orbitFetch(`/api/users/${encodeURIComponent(uId)}`, {}, identity)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            // The endpoint returns { user: {...} }. This read `data.id`, which
            // is always undefined, so this path always toasted "no longer on
            // this node" instead of opening the profile.
            const row = data?.user;
            if (row?.id) setSelectedProfileUser(row as unknown as User);
            else toast('That player is no longer on this node', 'info');
          })
          .catch(() => toast('Could not load that player', 'error'));
      }}
      subTab={gamesSubTab}
      onSubTabChange={setGamesSubTab}
      renderDuelContent={() => (
        <LobbyPanel
          lobby={lobby}
          toggleAutoQueue={toggleAutoQueue}
          sendInvite={sendInvite}
          identity={identity}
          myCards={myCards}
        hasActiveDeck={hasActiveDeck}
          soundEnabled={soundEnabled}
          onOpenImage={(url) => setLobbyLightboxUrl(url)}
          onExpandItem={(id) => setExpandedItemId(id)}
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
          profilePics={profilePics}
        />
      )}
      onOpenSources={() => setShowSources(true)}
      onRepostImage={onRepostImage}
      onAddToStory={onAddToStory}
      onCreateCard={onCreateCard}
      onSetWallpaper={onSetWallpaper}
    />
    {showSources && <CustomSourcesModal onClose={() => setShowSources(false)} />}
    </>
  );
}
