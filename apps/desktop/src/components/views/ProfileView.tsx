"use client";

import { useMemo } from 'react';
// Extracted verbatim from App.tsx `mainView === 'profile'` branch.
import type { OrbitIdentity } from '@orbit/crypto';
import { setSecureItem } from '../../utils/secure-storage'
import { computeCardRarity, type OrbitObject, type User } from '@orbit/shared';
import { GMatchProfile } from '../profile/GMatchProfile';
import { GameCard } from '../cards/GameCard';
import { isClickerCard, type MergedCard } from '../../utils/cardCollection';
import type { FeedPost, PostComment } from '../feed/GMatchFeed';
import { ObjectImage } from '../ObjectImage';
import { useGame } from '../../game/store';
import { classes, COLOR, GAP, PADDING, RADIUS, TYPE, WEIGHT } from '../../ui/tokens';

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
  onRepostPost,
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
  /** Repost from a profile text card (gated: no handler, no repost row). */
  onRepostPost?: (post: FeedPost) => void;
}) {
  // Only keeps the player actually SAVED belong here. Posts (published or
  // saved) are feed rows and stay in the Posts grid; an upload that was merely
  // posted is never a keepsake. A keep is admitted when it carries verified
  // local bytes (a content ref), including legacy rows; never while those
  // bytes are still downloading. A keep that never got bytes does not show.
  const gallery = useGame((s) => s.gallery);
  const media = useMemo(
    () => gallery.filter((keep) => !!keep.localRef && keep.saveState !== 'downloading').slice(-12).reverse(),
    [gallery],
  );
  // `myCards` arrives already merged (see App's mergeMyCards call); the shelf
  // is read-only, so it reuses those canonical rows as-is.
  const cards = myCards as MergedCard[];
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
        onRepostPost={onRepostPost}
      />
      {cards.length > 0 && (
        <section
          aria-label="Profile card collection"
          className={classes('mt-4 border', COLOR.edge, RADIUS.panel, COLOR.surfaceRaised, PADDING[4])}
        >
          <div className={classes('flex items-baseline justify-between', GAP[2])}>
            <h2 className={classes(TYPE.sub, WEIGHT.heading, COLOR.fg)}>Card collection ({cards.length})</h2>
            <span className={classes(TYPE.caption, COLOR.muted)}>Showing your top {Math.min(6, cards.length)}</span>
          </div>
          <p className={classes(TYPE.caption, COLOR.muted)}>Cards you forged — a read-only shelf of your keeps.</p>
          <div className={classes('grid grid-cols-2 sm:grid-cols-3', GAP[3])}>
            {cards.slice(0, 6).map((card) => (
              <GameCard
                key={card.card_id || card.id}
                objectId={card.id}
                src={card.content_url}
                identity={identity}
                width={150}
                height={210}
                isVideo={Boolean(card.mime_type?.startsWith('video/'))}
                name={card.name || card.caption}
                rarity={computeCardRarity(card.value ?? 0)}
                value={card.value ?? 0}
                accentColor={card.accent_color}
                frame={card.frame}
                clicker={card.clicker ?? isClickerCard(card)}
                interactive={false}
              />
            ))}
          </div>
        </section>
      )}
      {media.length > 0 && (
        <section
          aria-label="Profile keepsakes"
          className={classes('mt-4 border', COLOR.edge, RADIUS.panel, COLOR.surfaceRaised, PADDING[4])}
        >
          <h2 className={classes(TYPE.sub, WEIGHT.heading, COLOR.fg)}>Keepsakes ({media.length})</h2>
          <p className={classes(TYPE.caption, COLOR.muted)}>Saved to this device — separate from your posts.</p>
          <div className={classes('grid grid-cols-3 sm:grid-cols-4', GAP[2])}>
            {media.map((keep) => (
              <div key={keep.id} className={classes('aspect-square overflow-hidden border', COLOR.edge, COLOR.canvasSurface, RADIUS.control)}>
                <ObjectImage
                  contentUrl={keep.url}
                  objectId={keep.localRef || keep.url}
                  contentHash={keep.localRef}
                  mimeType={keep.kind === 'video' ? 'video/mp4' : undefined}
                  identity={identity}
                  alt=""
                  thumb
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
