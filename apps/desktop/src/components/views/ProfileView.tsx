"use client";

// Extracted verbatim from App.tsx `mainView === 'profile'` branch.
import type { OrbitIdentity } from '@orbit/crypto';
import { setSecureItem } from '../../utils/secure-storage'
import type { OrbitObject, User } from '@orbit/shared';
import { GMatchProfile } from '../profile/GMatchProfile';
import type { FeedPost } from '../feed/GMatchFeed';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
type MyProfileState = { displayName: string; tags: string[]; isAdmin: boolean; pfpUrl: string };

export function ProfileView({
  identity,
  myUser,
  profilePics,
  feedPosts,
  myCards,
  repostedPosts,
  followingIds,
  myProfile,
  toast,
  setShowSettingsModal,
  setFollowersModalState,
  setExpandedItemId,
  setMyProfile,
  setProfilePics,
  loadUsers,
  setArchivedPostIds,
  setDeletedPostIds,
  deletePostOnServer,
}: {
  identity: OrbitIdentity | null;
  myUser: User | undefined;
  profilePics: Record<string, string>;
  feedPosts: FeedPost[];
  myCards: OrbitObject[];
  repostedPosts: FeedPost[];
  followingIds: string[];
  myProfile: MyProfileState;
  toast: ToastFn;
  setShowSettingsModal: (v: boolean) => void;
  setFollowersModalState: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    initialTab: 'followers' | 'following';
    targetUserId?: string | null;
    targetName?: string | null;
  }>>;
  setExpandedItemId: (id: string | null) => void;
  setMyProfile: React.Dispatch<React.SetStateAction<MyProfileState>>;
  setProfilePics: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  loadUsers: () => void;
  setArchivedPostIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setDeletedPostIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  deletePostOnServer: (postId: string) => void;
}) {
  return (
    <div className="p-4 sm:p-8 w-full max-w-[1600px] mx-auto">
      <GMatchProfile
        identity={identity}
        myUser={myUser}
        profilePic={profilePics[identity?.orbitId || '']}
        posts={feedPosts}
        cards={myCards as any}
        savedPosts={feedPosts.filter((p) => p.is_saved)}
        repostPosts={repostedPosts}
        followersCount={myUser?.followers_count ?? myUser?.likes_received ?? 0}
        followingCount={myUser?.following_count ?? followingIds.length}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenFollowers={(tab) => setFollowersModalState({ isOpen: true, initialTab: tab, targetUserId: null, targetName: null })}
        onOpenCardViewer={(card) => {
          if (card.id) setExpandedItemId(card.id);
        }}
        onProfileUpdated={(updated) => {
          setMyProfile((prev) => ({ ...prev, displayName: updated.name, pfpUrl: updated.pfpUrl || prev.pfpUrl }));
          try { localStorage.setItem('orbit_display_name', updated.name); } catch { }
          if (updated.pfpUrl) {
            setProfilePics((prev) => {
              const next = { ...prev, [identity?.orbitId || '']: updated.pfpUrl as string };
              try { setSecureItem('goonmatch_pfps', JSON.stringify(next)); } catch { }
              return next;
            });
            try { localStorage.setItem('orbit_pfp_url', updated.pfpUrl); } catch { }
          }
          window.dispatchEvent(new CustomEvent('orbit_profile_updated', { detail: { displayName: updated.name, tags: myProfile.tags } }));
          loadUsers();
        }}
        onArchivePost={(id) => {
          setArchivedPostIds((prev) => new Set(prev).add(id));
          toast('Post archived', 'info');
        }}
        onDeletePost={(id) => {
          setDeletedPostIds((prev) => new Set(prev).add(id));
          deletePostOnServer(id);
          toast('Post deleted', 'success');
        }}
        toast={toast}
      />
    </div>
  );
}
