"use client";

import type { OrbitIdentity } from '@orbit/crypto';
import type { User, OrbitObject, ActiveHackDebuff } from '@orbit/shared';
import type { AppSettings } from '../hooks/useSettings';
import { Modal } from './Modal';
import { IdentityModal } from './IdentityModal';
import { HelpModal } from './HelpModal';
import { PointsHelpModal } from './PointsHelpModal';
import { FlashModal } from './FlashModal';
import { FlashOverlay } from './FlashOverlay';
import { MobileVirusOverlay } from './hacks/MobileVirusOverlay';
import { CreatePostModal } from './feed/CreatePostModal';
import { GMatchSettingsModal, type SettingsOpenTarget } from './settings/GMatchSettingsModal';
import { FollowersFollowingModal } from './profile/FollowersFollowingModal';
import { CoffeeModal } from './CoffeeModal';
import { RecommendationModal } from './RecommendationModal';

export interface GlobalModalsProps {
  identity: OrbitIdentity;
  users: User[];
  profilePics: Record<string, string>;
  settings: AppSettings;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  myProfile: { displayName: string; tags: string[]; isAdmin: boolean; pfpUrl: string };
  setMyProfile: React.Dispatch<React.SetStateAction<{ displayName: string; tags: string[]; isAdmin: boolean; pfpUrl: string }>>;
  stories: OrbitObject[];
  activeVirusHack: ActiveHackDebuff | null;
  setActiveHacks: React.Dispatch<React.SetStateAction<ActiveHackDebuff[]>>;
  relationships: any;
  followingIds: string[];
  items: OrbitObject[];

  identityModalMode: 'export' | 'login' | 'logout' | null;
  setIdentityModalMode: (mode: 'export' | 'login' | 'logout' | null) => void;
  exportIdentity: () => any;
  loginWithExportedId: (exportedData: string | object) => { success: boolean; error?: string; identity?: any };
  clearIdentity: () => void;
  handleFullConfigDownload: () => Promise<boolean>;
  handleFullConfigRestore: (file: File) => Promise<{ success: boolean; message: string }>;

  showHelpModal: boolean;
  setShowHelpModal: (v: boolean) => void;
  showPointsHelpModal: boolean;
  setShowPointsHelpModal: (v: boolean) => void;
  showFlashModal: boolean;
  setShowFlashModal: (v: boolean) => void;
  showSettingsModal: boolean;
  setShowSettingsModal: (v: boolean) => void;
  settingsInitialTab?: SettingsOpenTarget;
  showCreatePostModal: boolean;
  setShowCreatePostModal: (v: boolean) => void;
  createPostInitialData?: {
    mediaList?: Array<{ id: string; previewUrl: string; isExternalUrl?: boolean; file?: File }>;
    tags?: string;
    caption?: string;
  } | null;
  setCreatePostInitialData?: (v: any) => void;
  showStoryModal: boolean;
  setShowStoryModal: (v: boolean) => void;
  showMaxGoonerModal: boolean;
  setShowMaxGoonerModal: (v: boolean) => void;
  showRecommendations: boolean;
  setShowRecommendations: (v: boolean) => void;
  followersModalState: { isOpen: boolean; initialTab: 'followers' | 'following'; targetUserId?: string | null; targetName?: string | null };
  setFollowersModalState: React.Dispatch<React.SetStateAction<{ isOpen: boolean; initialTab: 'followers' | 'following'; targetUserId?: string | null; targetName?: string | null }>>;

  showCoffee: boolean;
  manualCoffeeOpen: boolean;
  triggerReason: 'time' | 'matches' | null;
  dismissCoffee: (mode: 'later' | 'never') => void;
  setManualCoffeeOpen: (v: boolean) => void;

  handleSetMainView: (view: any) => void;
  setMainView: React.Dispatch<React.SetStateAction<any>>;
  setDmMinimized: (v: boolean) => void;
  setPmPeer: (user: User | null) => void;
  setSelectedProfileUser: (user: User | null) => void;
  setSelectedIds: (ids: Set<string>) => void;
  setExpandedItemId: (id: string | null) => void;
  setStoryViewerUserId: (id: string | null) => void;

  loadUsers: () => any;
  loadGallery: () => any;
  loadStories: () => any;
  loadServerFeed: () => any;
  handleAddStory: (file: File) => Promise<void>;

  toggleFollowUser: (userId: string) => Promise<void>;

  toast: (text: string, type?: 'success' | 'error' | 'info' | 'warning') => void;

  storyFileInputRef: React.RefObject<HTMLInputElement | null>;
  pfpInputRef: React.RefObject<HTMLInputElement | null>;
  handleSetProfilePic: (file: File) => Promise<void>;

  lobby: any;
}

export function GlobalModals(props: GlobalModalsProps) {
  const { identity, users, profilePics, settings, updateSettings, setMyProfile, stories, activeVirusHack, setActiveHacks, relationships, followingIds, items, identityModalMode, setIdentityModalMode, exportIdentity, loginWithExportedId, clearIdentity, handleFullConfigDownload, handleFullConfigRestore, showHelpModal, setShowHelpModal, showPointsHelpModal, setShowPointsHelpModal, showFlashModal, setShowFlashModal, showSettingsModal, setShowSettingsModal, settingsInitialTab = 'preferences', showCreatePostModal, setShowCreatePostModal, createPostInitialData, setCreatePostInitialData, showStoryModal, setShowStoryModal, showMaxGoonerModal, setShowMaxGoonerModal, showRecommendations, setShowRecommendations, followersModalState, setFollowersModalState, showCoffee, manualCoffeeOpen, triggerReason, dismissCoffee, setManualCoffeeOpen, handleSetMainView, setMainView, setDmMinimized, setPmPeer, setSelectedProfileUser, setSelectedIds, setExpandedItemId, setStoryViewerUserId, loadUsers, loadGallery, loadStories, loadServerFeed, toggleFollowUser, toast, pfpInputRef, handleSetProfilePic, lobby } = props;



  return (
    <>
      <IdentityModal
        isOpen={identityModalMode !== null}
        onClose={() => setIdentityModalMode(null)}
        identity={identity}
        exportIdentity={exportIdentity}
        loginWithExportedId={loginWithExportedId}
        clearIdentity={() => {
          clearIdentity();
          setMyProfile({ displayName: '', tags: [], isAdmin: false, pfpUrl: '' });
          setSelectedIds(new Set());
          setMainView('feed');
          setDmMinimized(false);
          setShowSettingsModal(false);
          setActiveHacks([]);
        }}
        onIdentityChanged={(mode) => {
          if (mode === 'logout') {
            setIdentityModalMode(null);
            setMainView('feed');
            setDmMinimized(false);
            setShowSettingsModal(false);
            setActiveHacks([]);
            return;
          }
          loadUsers();
          loadGallery();
          loadStories();
          window.dispatchEvent(new CustomEvent('orbit-score-refresh'));
        }}
        toast={toast}
        initialMode={identityModalMode || 'export'}
        onFullConfigDownload={() => handleFullConfigDownload()}
        onFullConfigRestore={(file) => handleFullConfigRestore(file)}
      />

      {showHelpModal && (
        <HelpModal onClose={() => setShowHelpModal(false)} />
      )}

      <input
        ref={pfpInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleSetProfilePic(file)
        }}
        className="hidden"
      />

      {showStoryModal && (
        <CreatePostModal
          mode="story"
          identity={identity}
          onClose={() => setShowStoryModal(false)}
          onPostCreated={() => {
            loadStories();
            setShowStoryModal(false);
          }}
          toast={toast}
        />
      )}

      {showMaxGoonerModal && (
        <Modal title="Maximum Gooner Hardcore" onClose={() => setShowMaxGoonerModal(false)}>
          <div className="p-3 bg-retro-bg border border-border-glass text-xs text-retro-fg space-y-1 mb-3">
            <p className="font-bold uppercase tracking-wider">You&apos;ve been warned</p>
            <p>Maximum Gooner Mode turns on automatic image reception, chime audio alerts, blinking sender highlights, and auto-forwarding.</p>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between p-2.5 bg-retro-bg border border-border-glass cursor-pointer hover:border-retro-accent transition-colors">
              <span className="font-bold text-retro-fg">Master Hardcore Switch</span>
              <input
                type="checkbox"
                checked={settings.maximumGooner}
                onChange={(e) => {
                  const val = e.target.checked
                  updateSettings('maximumGooner', val)
                  if (val) {
                    updateSettings('autoOpenImages', true)
                    updateSettings('autoForwardAll', true)
                    updateSettings('idleEnabled', true)
                    updateSettings('soundEffects', true)
                  }
                }}
                className="w-4 h-4 accent-retro-accent cursor-pointer"
              />
            </label>
            <label className="flex items-center justify-between p-2.5 bg-retro-bg border border-border-glass cursor-pointer hover:border-retro-accent transition-colors">
              <span className="text-retro-fg">Sound effect on image arrival</span>
              <input type="checkbox" checked={settings.soundEffects} onChange={(e) => updateSettings('soundEffects', e.target.checked)} className="w-4 h-4 accent-retro-accent cursor-pointer" />
            </label>
            <label className="flex items-center justify-between p-2.5 bg-retro-bg border border-border-glass cursor-pointer hover:border-retro-accent transition-colors">
              <span className="text-retro-fg">▣ Auto-Open Image Lightbox</span>
              <input type="checkbox" checked={settings.autoOpenImages} onChange={(e) => updateSettings('autoOpenImages', e.target.checked)} className="w-4 h-4 accent-retro-accent cursor-pointer" />
            </label>
            <label className="flex items-center justify-between p-2.5 bg-retro-bg border border-border-glass cursor-pointer hover:border-retro-accent transition-colors">
              <span className="text-retro-fg">⇄ Auto-Forward to All Friends</span>
              <input type="checkbox" checked={settings.autoForwardAll} onChange={(e) => updateSettings('autoForwardAll', e.target.checked)} className="w-4 h-4 accent-retro-accent cursor-pointer" />
            </label>
            <label className="flex items-center justify-between p-2.5 bg-retro-bg border border-border-glass cursor-pointer hover:border-retro-accent transition-colors">
              <span className="text-retro-fg">▣ Allow Remote Wallpaper</span>
              <input type="checkbox" checked={settings.allowRemoteWallpaper} onChange={(e) => updateSettings('allowRemoteWallpaper', e.target.checked)} className="w-4 h-4 accent-retro-accent cursor-pointer" />
            </label>
          </div>
        </Modal>
      )}

      {activeVirusHack && (
        <MobileVirusOverlay
          cards={items as any}
          attackerName={activeVirusHack.attacker_name}
          onComplete={() => {
            setActiveHacks((prev) => prev.filter((h) => h.id !== activeVirusHack.id));
            toast('Virus lock expired. System restored.', 'info');
          }}
        />
      )}

      {showCreatePostModal && (
        <CreatePostModal
          identity={identity}
          initialMedia={createPostInitialData?.mediaList}
          initialTags={createPostInitialData?.tags}
          initialCaption={createPostInitialData?.caption}
          onClose={() => {
            setShowCreatePostModal(false);
            setCreatePostInitialData?.(null);
          }}
          onPostCreated={() => {
            loadServerFeed();
            setShowCreatePostModal(false);
            setCreatePostInitialData?.(null);
          }}
          toast={toast}
        />
      )}

      {showPointsHelpModal && <PointsHelpModal onClose={() => setShowPointsHelpModal(false)} />}

      {showFlashModal && identity && (
        <FlashModal
          identity={identity}
          onClose={() => setShowFlashModal(false)}
          toast={toast}
        />
      )}

      {showSettingsModal && (
        <GMatchSettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          settings={settings}
          updateSettings={updateSettings}
          identity={identity}
          onOpenIdentityModal={(mode) => {
            // Keep the identity modal above settings instead of leaving it hidden behind it.
            setShowSettingsModal(false);
            setIdentityModalMode(mode);
          }}
          toast={toast}
          initialTab={settingsInitialTab}
          onAccountDeleted={() => {
            // Server + device already wiped by the section; drop the shell back
            // to the register-again screen (same teardown as logout, below).
            clearIdentity();
            setMyProfile({ displayName: '', tags: [], isAdmin: false, pfpUrl: '' });
            setSelectedIds(new Set());
            setMainView('feed');
            setDmMinimized(false);
            setShowSettingsModal(false);
            setActiveHacks([]);
          }}
        />
      )}

      {followersModalState.isOpen && (
        <FollowersFollowingModal
          isOpen={followersModalState.isOpen}
          initialTab={followersModalState.initialTab}
          onClose={() => setFollowersModalState((prev) => ({ ...prev, isOpen: false }))}
          currentUserId={identity?.orbitId || ''}
          identity={identity}
          targetUserId={followersModalState.targetUserId ?? null}
          targetDisplayName={followersModalState.targetName ?? null}
          users={users}
          followingIds={followingIds}
          relationships={relationships}
          profilePics={profilePics}
          stories={stories}
          onToggleFollow={(uId) => {
            void toggleFollowUser(uId);
          }}
          onSelectUser={(uId) => {
            const target = users.find((u) => u.id === uId || (u as any).orbitId === uId);
            if (target) setSelectedProfileUser(target);
          }}
          onOpenStory={(uId) => {
            setExpandedItemId(null);
            setMainView('feed');
            setStoryViewerUserId(uId);
          }}
          onStartPm={(u) => {
            const targetUser = users.find((usr) => usr.id === u.id) || ({ id: u.id, display_name: u.display_name } as User);
            setPmPeer(targetUser);
            handleSetMainView('messages');
          }}
          onSendCard={(userId) => {
            setSelectedIds(new Set([userId]));
            setMainView('game');
          }}
          toast={toast}
        />
      )}

      {lobby.flash && <FlashOverlay flash={lobby.flash} onLike={lobby.likeFlash} onDismiss={lobby.dismissFlash} identity={identity} />}

      <CoffeeModal
        open={showCoffee || manualCoffeeOpen}
        reason={triggerReason || null}
        onDismiss={(choice) => {
          dismissCoffee(choice);
          setManualCoffeeOpen(false);
        }}
      />

      {showRecommendations && (
        <RecommendationModal
          identity={identity}
          onClose={() => setShowRecommendations(false)}
          toast={toast}
        />
      )}
    </>
  );
}
