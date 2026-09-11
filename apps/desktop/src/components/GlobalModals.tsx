"use client";

import type { OrbitIdentity } from '@orbit/crypto';
import type { User, OrbitObject, ActiveHackDebuff } from '@orbit/shared';
import type { AppSettings } from '../hooks/useSettings';
import { Modal } from './Modal';
import { DropZone } from './DropZone';
import { useCropper } from '../hooks/useCropper';
import { isCropableImage } from './CropModal';
import { IdentityModal } from './IdentityModal';
import { HelpModal } from './HelpModal';
import { PointsHelpModal } from './PointsHelpModal';
import { FlashModal } from './FlashModal';
import { FlashOverlay } from './FlashOverlay';
import { MobileVirusOverlay } from './hacks/MobileVirusOverlay';
import { CreatePostModal } from './feed/CreatePostModal';
import { GMatchSettingsModal } from './settings/GMatchSettingsModal';
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
  settingsInitialTab?: 'preferences' | 'wallpaper';
  showCreatePostModal: boolean;
  setShowCreatePostModal: (v: boolean) => void;
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
  const { identity, users, profilePics, settings, updateSettings, setMyProfile, stories, activeVirusHack, setActiveHacks, relationships, followingIds, items, identityModalMode, setIdentityModalMode, exportIdentity, loginWithExportedId, clearIdentity, handleFullConfigDownload, handleFullConfigRestore, showHelpModal, setShowHelpModal, showPointsHelpModal, setShowPointsHelpModal, showFlashModal, setShowFlashModal, showSettingsModal, setShowSettingsModal, settingsInitialTab = 'preferences', showCreatePostModal, setShowCreatePostModal, showStoryModal, setShowStoryModal, showMaxGoonerModal, setShowMaxGoonerModal, showRecommendations, setShowRecommendations, followersModalState, setFollowersModalState, showCoffee, manualCoffeeOpen, triggerReason, dismissCoffee, setManualCoffeeOpen, handleSetMainView, setMainView, setDmMinimized, setPmPeer, setSelectedProfileUser, setSelectedIds, setExpandedItemId, setStoryViewerUserId, loadUsers, loadGallery, loadStories, loadServerFeed, handleAddStory, toggleFollowUser, toast, storyFileInputRef, pfpInputRef, handleSetProfilePic, lobby } = props;

  const { crop, cropper } = useCropper();

  // Stories are shown in a 9:16 tray — crop up front, like Instagram.
  const handleAddStoryCropped = async (file: File) => {
    if (isCropableImage(file)) {
      const res = await crop(file, { aspect: '9:16', title: 'Crop story' });
      if (!res) return;
      if (res.file) { handleAddStory(res.file); return; }
    }
    handleAddStory(file);
  };

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
        <Modal title="Post a Story" onClose={() => setShowStoryModal(false)}>
          <p className="text-[11px] text-retro-muted mb-3">
            Stories live for <span className="text-retro-accent font-bold">12 hours</span> and then wipe — posting one earns{' '}
            <span className="text-retro-accent font-bold">+10 PTS</span>. Drop an image or click to browse:
          </p>
          <DropZone
            compact
            onFiles={(list) => { if (list[0]) void handleAddStoryCropped(list[0]) }}
          >
            <div className="text-[11px] text-retro-fg flex items-center justify-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-retro-accent"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              <span>Drop an image here or click to browse</span>
            </div>
          </DropZone>
          <input
            ref={storyFileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleAddStoryCropped(file)
            }}
            className="hidden"
          />
          <div className="mt-3 p-3 border border-retro-accent bg-glass-w10 flex items-center justify-between">
            <div>
              <div className="font-bold text-retro-fg">12h Story</div>
              <div className="text-[10px] text-retro-muted">Expires in 12 hours</div>
            </div>
            <span className="px-2.5 py-1 border text-[11px] font-bold bg-retro-bg text-retro-accent border-retro-accent">
              +10 PTS
            </span>
          </div>
        </Modal>
      )}

      {showMaxGoonerModal && (
        <Modal title="Maximum Gooner Hardcore" onClose={() => setShowMaxGoonerModal(false)}>
          <div className="p-3 bg-retro-bg border border-border-glass text-[11px] text-retro-fg space-y-1 mb-3">
            <p className="font-bold uppercase tracking-wider">⚠ YOU&apos;VE BEEN WARNED</p>
            <p>Maximum Gooner Mode turns on automatic image reception, chime audio alerts, blinking sender highlights, and auto-forwarding.</p>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between p-2.5 bg-retro-bg border border-border-glass cursor-pointer hover:border-retro-accent transition-colors">
              <span className="font-bold text-retro-fg">♦ Master Hardcore Switch</span>
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
              <span className="text-retro-fg">♪ Sound Effect on Image Arrival</span>
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
            toast('Virus lock expired! System restored.', 'info');
          }}
        />
      )}

      {showCreatePostModal && (
        <CreatePostModal
          identity={identity}
          onClose={() => setShowCreatePostModal(false)}
          onPostCreated={() => {
            loadServerFeed();
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
      {cropper}
    </>
  );
}
