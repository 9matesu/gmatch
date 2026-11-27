"use client";

// Extracted verbatim from App.tsx `mainView === 'profile'` branch.
import type { OrbitIdentity } from '@orbit/crypto';
import { setSecureItem } from '../../utils/secure-storage'
import type { OrbitObject, User } from '@orbit/shared';
import { GMatchProfile } from '../profile/GMatchProfile';
import type { FeedPost, PostComment } from '../feed/GMatchFeed';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
type MyProfileState = { displayName: string; tags: string[]; isAdmin: boolean; pfpUrl: string; bio?: string; website?: string };

export function ProfileView({
  identity,
  myUser,
  profilePics,
  feedPosts,
  savedPosts,
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
  users,
  onSendDm,
  onPersistLike,
  onPersistSave,
  onPersistComment,
  onSelectUser,
  onOpenNetwork,
  shareGroups,
  onEditPost,
}: {
  identity: OrbitIdentity | null;
  myUser: User | undefined;
  profilePics: Record<string, string>;
  feedPosts: FeedPost[];
  /** The posts this player saved — the "Saved" tab, read from the node. */
  savedPosts: FeedPost[];
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
  /** Resolves how the delete went: node-confirmed, local-only, or failed. */
  deletePostOnServer: (postId: string) => Promise<'deleted' | 'local' | 'failed'>;
  users: Array<{ id: string; display_name?: string }>;
  onSendDm: (peerId: string, text: string) => Promise<boolean>;
  onPersistLike: (postId: string, liked: boolean) => Promise<number | undefined>;
  onPersistSave: (postId: string, saved: boolean) => void;
  onPersistComment: (postId: string, text: string) => Promise<PostComment | null>;
  onSelectUser: (userId: string) => void;
  onOpenNetwork: (userId: string) => void;
  shareGroups: { id: string; name: string; member_count: number }[];
  /** Edit the caption of an own post. The caller owns the request + the toast. */
  onEditPost?: (post: FeedPost) => void;
}) {
  return (
    <div className="p-4 sm:p-6 w-full max-w-3xl mx-auto">
      <GMatchProfile
        identity={identity}
        myUser={myUser}
        profilePic={profilePics[identity?.orbitId || '']}
        posts={feedPosts}
        cards={myCards as any}
        savedPosts={savedPosts}
        repostPosts={repostedPosts}
        // No `?? likes_received` fallback: that is a LIKES count rendered under
        // a "followers" label, which is why the number could disagree with the
        // list you get by clicking it.
        followersCount={myUser?.followers_count ?? 0}
        followingCount={followingIds.length}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenFollowers={(tab) => setFollowersModalState({ isOpen: true, initialTab: tab, targetUserId: null, targetName: null })}
        onOpenCardViewer={(card) => {
          if (card.id) setExpandedItemId(card.id);
        }}
        onProfileUpdated={(updated) => {
          setMyProfile((prev) => ({ ...prev, displayName: updated.name, pfpUrl: updated.pfpUrl || prev.pfpUrl, tags: updated.tags ?? prev.tags }));
          try { localStorage.setItem('orbit_display_name', updated.name); } catch { }
          if (updated.tags) {
            try { localStorage.setItem('orbit_tags', JSON.stringify(updated.tags)); } catch { }
          }
          if (updated.pfpUrl) {
            setProfilePics((prev) => {
              const next = { ...prev, [identity?.orbitId || '']: updated.pfpUrl as string };
              try { setSecureItem('goonmatch_pfps', JSON.stringify(next)); } catch { }
              return next;
            });
            try { localStorage.setItem('orbit_pfp_url', updated.pfpUrl); } catch { }
          }
          window.dispatchEvent(new CustomEvent('orbit_profile_updated', { detail: { displayName: updated.name, tags: updated.tags ?? myProfile.tags ?? [] } }));
          loadUsers();
        }}
        onArchivePost={(id) => {
          setArchivedPostIds((prev) => new Set(prev).add(id));
          toast('Post archived', 'info');
        }}
        onDeletePost={async (id) => {
          // Only claim the delete once it actually happened. A post that never
          // reached the node (a local-only outbox row) is removed locally, so
          // that is a success with different wording, not a failure.
          const result = await deletePostOnServer(id);
          if (result === 'failed') {
            toast('Could not delete the post', 'error');
            return;
          }
          setDeletedPostIds((prev) => new Set(prev).add(id));
          toast(result === 'local' ? 'Post removed from this device' : 'Post deleted', 'success');
        }}
        followingIds={followingIds}
        users={users}
        shareGroups={shareGroups}
        onSendDm={onSendDm}
        onPersistLike={onPersistLike}
        onPersistSave={onPersistSave}
        onPersistComment={onPersistComment}
        onSelectUser={onSelectUser}
        onOpenNetwork={onOpenNetwork}
        profileTags={myProfile.tags}
        toast={toast}
        onEditPost={onEditPost}
      />
    </div>
  );
}
