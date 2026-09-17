"use client";

// Extracted verbatim from App.tsx `mainView === 'game'` branch:
// LobbyPanel + the conditional SendPanel transfer block.
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject, User } from '@orbit/shared';
import type { useLobby } from '../../hooks/useLobby';
import { LobbyPanel } from '../LobbyPanel';
import { SendPanel } from '../SendPanel';
import type { SendPanelHandle } from '../SendPanel';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

export function GameView({
  lobby,
  toggleAutoQueue,
  sendInvite,
  identity,
  myCards,
  hasActiveDeck,
  soundEnabled,
  users,
  profilePics,
  spinTarget,
  selectedIds,
  setSelectedIds,
  sendPanelRef,
  forwardedStashFile,
  setForwardedStashFile,
  setTransferProgress,
  toast,
  loadGallery,
  loadUsers,
  sendP2PItem,
  setLobbyLightboxUrl,
  setExpandedItemId,
  setShowHelpModal,
  setSelectedProfileUser,
  setSpectateViewerItems,
  openCreateCardModal,
  navigateToDeckBuilder,
}: {
  lobby: ReturnType<typeof useLobby>;
  toggleAutoQueue: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  sendInvite: (userId: string) => Promise<{ ok: boolean; error?: string }>;
  identity: OrbitIdentity;
  myCards: OrbitObject[];
  hasActiveDeck: boolean;
  soundEnabled: boolean;
  users: User[];
  profilePics?: Record<string, string>;
  spinTarget: User | null;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  sendPanelRef: React.RefObject<SendPanelHandle | null>;
  forwardedStashFile: File | null;
  setForwardedStashFile: (f: File | null) => void;
  setTransferProgress: (p: string | null) => void;
  toast: ToastFn;
  loadGallery: () => void;
  loadUsers: () => void;
  sendP2PItem: (item: OrbitObject) => void;
  setLobbyLightboxUrl: (url: string | null) => void;
  setExpandedItemId: (id: string | null) => void;
  setShowHelpModal: (v: boolean) => void;
  setSelectedProfileUser: (user: User) => void;
  setSpectateViewerItems: (items: OrbitObject[] | null) => void;
  openCreateCardModal: () => void;
  navigateToDeckBuilder: () => void;
}) {
  return (
    <div className="space-y-6">
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
        onOpenHelp={() => setShowHelpModal(true)}
        onOpenProfile={(user) => setSelectedProfileUser(user)}
        onOpenCreateCard={openCreateCardModal}
        onOpenDeckBuilder={navigateToDeckBuilder}
        onOpenSpectateItem={(items, initialId) => {
          setSpectateViewerItems(items)
          setExpandedItemId(initialId)
        }}
        users={users}
        profilePics={profilePics}
      />

      {(spinTarget || selectedIds.size > 0) && (
        <div className="w-full max-w-2xl mx-auto mb-6 module">
          <SendPanel
            ref={sendPanelRef}
            index="03"
            identity={identity}
            recipientIds={Array.from(selectedIds)}
            users={users}
            onRecipientsChange={(ids) => setSelectedIds(new Set(ids))}
            onUploadComplete={() => { loadGallery(); loadUsers(); window.dispatchEvent(new CustomEvent('orbit-relationships-refresh')) }}
            onTransferStart={() => setTransferProgress('Encrypting...')}
            onTransferProgress={(pct) => setTransferProgress(`Uploading: ${pct}%`)}
            onTransferComplete={() => {
              setTransferProgress(null)
              setForwardedStashFile(null)
              toast('Card sent.', 'success')
              loadGallery()
              loadUsers()
              window.dispatchEvent(new CustomEvent('orbit-relationships-refresh'))
            }}
            onTransferError={(err) => { setTransferProgress(null); toast(`Upload failed: ${err}`, 'error') }}
            forwardedFile={forwardedStashFile}
            onForwardClear={() => setForwardedStashFile(null)}
            onSendP2PItem={sendP2PItem}
          />
        </div>
      )}
    </div>
  );
}
