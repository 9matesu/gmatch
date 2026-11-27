"use client";

import { useMemo, useState, useEffect } from 'react';
import { playPress } from '../../utils/sounds';
import {
  Grid,
  Bookmark,
  Layers,
  Settings,
  Share2,
  ExternalLink,
  Heart,
  MessageCircle,
  Camera,
  Repeat,
  CheckCircle2,
  Flame,
  Play,
} from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject as StoredCard } from '@orbit/shared';
import type { FeedPost } from '../feed/GMatchFeed';
import { ProfileEditorModal } from './ProfileEditorModal';
import { ProfilePicModal } from './ProfilePicModal';
import { useProfilePostLightbox } from '../feed/useProfilePostLightbox';
import { ObjectImage } from '../ObjectImage';
import { isVideoPost } from '../../utils/media';
import { saveUserProfile } from '../../utils/profile';
import { openCardDetail } from '../../utils/openCard';
import { profileShareUrl, orbitFetch, invalidateCache } from '../../utils/api';
import { mergeFollowIds } from '../../utils/followList';
import { usePeerFollowEdges } from '../../hooks/usePeerFollows';
import {
  classes, COLOR, GAP, ICON, MONO, MOTION, PADDING, PADDING_X, PADDING_Y,
  PADDING_SM, PRESENCE, RADIUS, SHADOW, TRACKING, TRANSITION, TYPE, WEIGHT,
} from '../../ui/tokens';
import { Button } from '../../ui/kit';

/**
 * SURFACE + TYPOGRAPHY recipes for the repeated profile chrome. Every value is
 * composed from ui/tokens; the grid, the lightbox contract and the 18+ gate are
 * untouched. One recipe per shape means the raised header, the action buttons,
 * the tabs and the media cells cannot drift apart in colour/size/weight.
 */
const PROFILE_ROOT = classes(
  'w-full font-sans select-none overflow-hidden animate-orbit-fade-in',
  COLOR.canvasSurface, 'border', COLOR.edge, RADIUS.panel, COLOR.fg, SHADOW.modal,
);
const PROFILE_HEADER = classes(COLOR.surfaceRaised, 'border-b', COLOR.edge, PADDING[4], PADDING_SM[6], 'flex flex-col', GAP[4]);
const TAB_BTN = classes(
  'py-1.5 px-3 flex items-center justify-center cursor-pointer',
  GAP[1.5], TYPE.body, WEIGHT.medium, RADIUS.chip, TRANSITION.micro,
);
const GRID_CELL = classes('relative aspect-square overflow-hidden cursor-pointer group', COLOR.canvasSurface);
const CELL_IMG = classes('w-full h-full object-cover group-hover:scale-105', MOTION.transition.transform);
const CELL_GRID = classes('grid grid-cols-3 sm:gap-1', GAP[0.5]);
const EMPTY_CELL = classes('col-span-3 py-16 text-center', TYPE.body, COLOR.muted);
const VIDEO_CHIP = classes('absolute top-1.5 right-1.5 p-1 pointer-events-none z-[var(--z-dropdown)]', COLOR.scrim, 'backdrop-blur-xs', RADIUS.chip, COLOR.fg);
const CELL_SCRIM = classes(
  'absolute inset-0 opacity-0 group-hover:opacity-100', MOTION.transition.fade,
  'flex items-center justify-center z-[var(--z-dropdown)]', COLOR.fg, TYPE.body, WEIGHT.medium, COLOR.mediaVeil,
);

/**
 * The ids a follower/following JSON answer carries.
 *
 * A failed request is treated as an EMPTY list on purpose: the tab that opens
 * from this counter merges the same way (an unreachable node contributes
 * nothing), so the number and the rows cannot disagree about what the node
 * knows.
 */
function followerIdsFrom(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => (row as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string');
}

export function GMatchProfile({
  identity,
  myUser,
  profilePic,
  posts = [],
  cards = [],
  savedPosts = [],
  repostPosts = [],
  followersCount = 0,
  followingCount = 0,
  onOpenSettings,
  onOpenFollowers,
  onOpenCardViewer,
  onProfileUpdated,
  followingIds = [],
  users = [],
  shareGroups = [],
  onSendDm,
  onPersistLike,
  onPersistSave,
  onPersistComment,
  onSelectUser,
  onOpenNetwork,
  onCopyLink,
  onReportPost,
  onArchivePost,
  onDeletePost,
  onEditPost,
  profileTags = [],
  toast,
}: {
  identity: OrbitIdentity | null;
  myUser: any;
  profilePic?: string;
  posts: FeedPost[];
  cards: StoredCard[];
  savedPosts?: FeedPost[];
  repostPosts?: FeedPost[];
  followersCount?: number;
  followingCount?: number;
  activePowerups?: string[];
  onOpenSettings?: () => void;
  onOpenFollowers?: (tab: 'followers' | 'following') => void;
  onOpenCardViewer?: (card: any) => void;
  onProfileUpdated?: (updated: { name: string; bio: string; website: string; pfpUrl?: string; tags?: string[] }) => void;
  onArchivePost?: (postId: string) => void;
  onDeletePost?: (postId: string) => void;
  /** Edit the caption of an own post. The caller owns the request + the toast. */
  onEditPost?: (post: FeedPost) => void;
  followingIds?: string[];
  users?: Array<{ id: string; display_name?: string }>;
  shareGroups?: { id: string; name: string; member_count: number }[];
  onSendDm?: (peerId: string, text: string) => Promise<boolean>;
  onPersistLike?: (postId: string, liked: boolean) => Promise<number | undefined>;
  onPersistSave?: (postId: string, saved: boolean) => void;
  onPersistComment?: (postId: string, text: string) => Promise<any>;
  onSelectUser?: (userId: string) => void;
  onOpenNetwork?: (userId: string) => void;
  onCopyLink?: (post: FeedPost) => void;
  onReportPost?: (post: FeedPost) => void;
  profileTags?: string[];
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const [profileTab, setProfileTab] = useState<'posts' | 'saved' | 'reposts' | 'cards'>('posts');
  const [showEditor, setShowEditor] = useState(false);
  const { openPost, expandedNode, modals: postLightboxModals } = useProfilePostLightbox({
    identity,
    profilePics: profilePic ? { [identity?.orbitId || '']: profilePic } : {},
    users,
    followingIds,
    shareGroups,
    toast,
    onPersistLike,
    onPersistSave,
    onPersistComment,
    onSendDm,
    onSelectUser,
    onOpenNetwork,
    onCopyLink,
    onArchivePost,
    onDeletePost,
    onReportPost,
    onEditPost,
  });
  const [bio, setBio] = useState(() => myUser?.bio || '');
  const [website, setWebsite] = useState(() => myUser?.website || '');
  const [displayName, setDisplayName] = useState(
    () => myUser?.display_name?.trim() || myUser?.name?.trim() || (typeof window !== 'undefined' ? localStorage.getItem('orbit_display_name') : '') || 'Unknown User'
  );
  const [pfp, setPfp] = useState(() => profilePic || myUser?.pfp_url || '');

  useEffect(() => {
    if (myUser) {
      const name = myUser.display_name || myUser.name;
      if (name) setDisplayName(name);
      if (myUser.bio !== undefined) setBio(myUser.bio);
      if (myUser.website !== undefined) setWebsite(myUser.website);
      if (myUser.pfp_url) setPfp(myUser.pfp_url);
    }
  }, [myUser]);

  useEffect(() => {
    if (profilePic) {
      setPfp(profilePic);
    }
  }, [profilePic]);
  const activePowerups: string[] = [];

  const isFlashing = activePowerups.includes('powerup_flash') || activePowerups.includes('flash');
  const isVerified = activePowerups.includes('powerup_verified') || activePowerups.includes('verified') || myUser?.is_admin;

  const myPosts = posts.filter(
    (p) => identity && p.author_id === identity.orbitId && !p.is_archived && !p.id.startsWith('stream_') && !p.id.startsWith('booru_') && !p.is_sponsored
  );
  const displayPosts = myPosts;

  // isVideoPost ran four times per render (once per grid) with a fresh
  // post.media.map() each time. The profile re-renders often, so this was
  // thousands of allocations and regex tests per second. One pass per list.
  const videoPostIds = useMemo(() => {
    const ids = new Set<string>()
    for (const post of [...displayPosts, ...(savedPosts ?? []), ...(repostPosts ?? [])]) {
      if (isVideoPost(post.mime_type, post.url, post.media?.map((mm) => mm.mime_type) ?? [])) ids.add(post.id)
    }
    return ids
  }, [displayPosts, savedPosts, repostPosts]);

  const videoCardIds = useMemo(() => {
    const ids = new Set<string>()
    for (const card of cards) {
      if (isVideoPost(card.mime_type, card.content_url || (card as { url?: string }).url)) ids.add(card.id)
    }
    return ids
  }, [cards]);

  const isSelf = Boolean(identity && (!myUser?.id || myUser?.id === identity.orbitId));
  const [showPfpModal, setShowPfpModal] = useState(false);

  const handleShareProfile = async () => {
    playPress(800);
    const profileUrl = identity ? profileShareUrl(identity.orbitId) : ''
    if (!profileUrl) { toast?.('Sign in to share your profile', 'warning'); return }
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(profileUrl);
        toast?.('Profile link copied', 'success');
      }
    } catch {
      toast?.('Failed to copy profile link', 'error');
    }
  };

  const handleSavePfp = async (newPfp: string) => {
    setPfp(newPfp);
    // The server ref (/api/objects/<id>) is what must stick everywhere.
    // Propagating the local data:/blob: URL instead is why pfps looked set
    // this session and vanished on restart (or 404'd for peers).
    let serverPfp: string | null = null;
    if (identity) {
      try {
        let persisted = newPfp;
        if (persisted.startsWith('blob:')) {
          const blob = await fetch(persisted).then((r) => r.blob());
          persisted = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        }
        const res = await saveUserProfile(identity, {
          display_name: displayName?.trim() || undefined,
          pfp_url: persisted,
        });
        if (!res.ok) throw new Error(`Profile save failed (${res.status})`);
        if (typeof res.pfpUrl === 'string' && res.pfpUrl) {
          serverPfp = res.pfpUrl;
          setPfp(serverPfp);
        }
      } catch {
        toast?.('Could not save profile photo', 'error');
      }
    }
    onProfileUpdated?.({
      name: displayName,
      bio,
      website,
      pfpUrl: serverPfp || newPfp,
    });
  };

  const [liveFollowerIds, setLiveFollowerIds] = useState<string[] | null>(null);
  const [liveFollowingIds, setLiveFollowingIds] = useState<string[] | null>(null);

  useEffect(() => {
    const targetId = isSelf ? identity?.orbitId : myUser?.id;
    if (!targetId) return;

    let cancelled = false;
    const fetchCounts = async () => {
      invalidateCache(`/api/users/${encodeURIComponent(targetId)}/followers`);
      if (!isSelf) {
        invalidateCache(`/api/users/${encodeURIComponent(targetId)}/following`);
      }
      try {
        const [followersRes, followingRes] = await Promise.all([
          orbitFetch(`/api/users/${encodeURIComponent(targetId)}/followers`, {}, identity),
          !isSelf ? orbitFetch(`/api/users/${encodeURIComponent(targetId)}/following`, {}, identity) : Promise.resolve(null),
        ]);
        const followers = followersRes && followersRes.ok ? await followersRes.json() : null;
        const following = followingRes && followingRes.ok ? await followingRes.json() : null;
        if (!cancelled) {
          setLiveFollowerIds(followerIdsFrom(followers));
          if (!isSelf) setLiveFollowingIds(followerIdsFrom(following));
        }
      } catch {
        /* ignore */
      }
    };

    void fetchCounts();

    const onSync = () => { void fetchCounts(); };
    const onFollow = (e: Event) => {
      const detail = (e as CustomEvent<{ follower_id?: string; followee_id?: string }>).detail;
      if (!detail || detail.followee_id === targetId || detail.follower_id === targetId) {
        void fetchCounts();
      }
    };

    window.addEventListener('orbit-profilesync', onSync);
    window.addEventListener('orbit-follow-event', onFollow);
    return () => {
      cancelled = true;
      window.removeEventListener('orbit-profilesync', onSync);
      window.removeEventListener('orbit-follow-event', onFollow);
    };
  }, [identity, identity?.orbitId, myUser?.id, isSelf]);

  // The node's counters are bookkeeping, and a follow signed while the node was
  // unreachable never reached its table. The number above a tab merges the SAME
  // operations the tab lists, so the count cannot disagree with the rows the
  // modal shows for the same profile.
  const peerEdges = usePeerFollowEdges(isSelf ? identity?.orbitId : myUser?.id);
  const mergedFollowerCount = liveFollowerIds
    ? mergeFollowIds(liveFollowerIds, {
        added: peerEdges.followers,
        removed: peerEdges.withdrawnFollowers,
      }).length
    : null;
  const mergedFollowingCount = liveFollowingIds
    ? mergeFollowIds(liveFollowingIds, {
        added: peerEdges.following,
        removed: peerEdges.withdrawnFollowing,
      }).length
    : null;

  const effectiveFollowersCount = mergedFollowerCount ?? followersCount ?? myUser?.followers_count ?? 0;
  const effectiveFollowingCount = isSelf
    ? followingIds.length
    : (mergedFollowingCount ?? followingCount ?? myUser?.following_count ?? 0);

  const stats = [
    { label: 'posts', value: displayPosts.length, onClick: () => setProfileTab('posts') },
    { value: effectiveFollowersCount, label: 'followers', onClick: () => { playPress(700); onOpenFollowers?.('followers'); } },
    { value: effectiveFollowingCount, label: 'following', onClick: () => { playPress(700); onOpenFollowers?.('following'); } },
  ];

  const tabs = [
    { id: 'posts', label: 'Posts', icon: Grid },
    { id: 'saved', label: 'Saved', icon: Bookmark },
    { id: 'reposts', label: 'Reposts', icon: Repeat },
    { id: 'cards', label: 'Cards', icon: Layers },
  ];

  return (
    <div className={PROFILE_ROOT}>
      {/* Profile Header */}
      <div className={PROFILE_HEADER}>
        {/* Avatar & Stats */}
        <div className={classes('flex items-center', GAP[5], 'sm:gap-6')}>
          {/* Avatar */}
          <button
            type="button"
            onClick={() => {
              if (isSelf) {
                playPress(750);
                setShowPfpModal(true);
              }
            }}
            disabled={!isSelf}
            aria-label={isSelf ? 'Change profile photo' : displayName}
            className={classes(
              'relative w-20 h-20 sm:w-24 sm:h-24 shrink-0 group p-0 text-left',
              RADIUS.pill, 'overflow-hidden border-2',
              isSelf ? 'cursor-pointer' : 'cursor-default',
              isFlashing ? COLOR.accentEdge : COLOR.edge,
            )}
          >
            {pfp ? (
              <ObjectImage
                contentUrl={pfp}
                objectId={pfp?.includes('/api/objects/') ? pfp.slice(pfp.indexOf('/api/objects/') + 13).split(/[?#]/)[0] : null}
                identity={identity}
                alt={displayName}
                className={CELL_IMG}
                loading="eager"
                fetchPriority="high"
                hideUnavailable
                onMediaUnavailable={() => setPfp('')}
              />
            ) : (
              <div className={classes('w-full h-full flex items-center justify-center sm:text-2xl', COLOR.interactive, TYPE.display, WEIGHT.medium, COLOR.muted)}>
                {(displayName || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            {isSelf && (
              <div className={classes('absolute inset-0 opacity-0 group-hover:opacity-100 flex items-center justify-center', MOTION.transition.fade, COLOR.scrimSoft)}>
                <Camera className={classes(ICON.lg, COLOR.fg)} />
              </div>
            )}
          </button>

          {/* Stats */}
          <div className={classes('flex-1 flex items-center justify-around text-center', GAP[2])}>
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col cursor-pointer"
                onClick={(stat as any).onClick}
              >
                <span className={classes(TYPE.base, WEIGHT.semibold, COLOR.fg, MONO)}>
                  {stat.value}
                </span>
                <span className={classes(TYPE.body, COLOR.muted)}>{stat.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Name & Bio */}
        <div className="space-y-1">
          <div className={classes('flex items-center min-w-0', GAP[1.5])}>
            <h2 className={classes(TYPE.display, WEIGHT.heading, TRACKING.tight, COLOR.fg, 'truncate')}>{displayName}</h2>
            {isVerified && (
              <span title="Verified">
                <CheckCircle2 className={classes(ICON.md, COLOR.accent, 'shrink-0')} />
              </span>
            )}
            {isFlashing && (
              <span title="Flash active">
                <Flame className={classes(ICON.sm, COLOR.accent, 'fill-retro-accent')} />
              </span>
            )}
          </div>
          {bio && (
            <p className={classes(TYPE.body, COLOR.body, 'whitespace-pre-line break-words')}>{bio}</p>
          )}
          {website && (
            <a
              href={website.startsWith('http') ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className={classes(TYPE.body, COLOR.accent, 'hover:underline flex items-center', GAP[1])}
            >
              <ExternalLink className={ICON.sm} />
              <span>{website.replace(/^https?:\/\//, '')}</span>
            </a>
          )}
        </div>

        {/* Action Buttons */}
        <div className={classes('flex items-center', GAP[2])}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => { playPress(800); setShowEditor(true); }}
            className="flex-1"
          >
            Edit profile
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={handleShareProfile}
            className={classes('flex-1', 'flex items-center justify-center', GAP[1.5])}
          >
            <Share2 className={ICON.sm} />
            <span>Share</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => { playPress(750); onOpenSettings?.(); }}
            title="Settings"
            // The command island renders a Settings button that is mounted on
            // every view, including the profile. Two controls named "Settings"
            // on one screen are indistinguishable to a screen reader, so this
            // one names its surface. Behaviour is unchanged.
            aria-label="Profile settings"
            className={PADDING[2]}
          >
            <Settings className={ICON.md} />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className={classes(COLOR.surfaceRaised, 'border-b', COLOR.edge, 'flex items-center', GAP[1], PADDING_X[2], PADDING_Y[2])}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = profileTab === tab.id;
          return (
            <Button
              key={tab.id}
              type="button"
              variant={isActive ? 'secondary' : 'ghost'}
              onClick={() => { playPress(750); setProfileTab(tab.id as any); }}
              className={classes(TAB_BTN, isActive ? COLOR.fg : COLOR.muted)}
            >
              <Icon className={ICON.md} />
              <span className="hidden sm:inline">{tab.label}</span>
            </Button>
          );
        })}
      </div>

      {/* Grid */}
      <div className={classes(PADDING[1], PADDING_SM[1.5])}>
        {profileTab === 'posts' && (
          <div className={CELL_GRID}>
            {expandedNode}
            {displayPosts.map((post) => (
              <div
                key={post.id}
                data-post-id={post.id}
                onClick={() => {
                  playPress(700);
                  openPost(post);
                }}
                className={GRID_CELL}
              >
                <ObjectImage
                  objectId={post.id}
                  contentUrl={post.url}
                  identity={identity}
                  mimeType={post.mime_type}
                  alt=""
                  className={CELL_IMG}
                  videoClassName={CELL_IMG}
                  muted
                  autoPlay={false}
                  playsInline
                />
                {videoPostIds.has(post.id) && (
                  <div className={VIDEO_CHIP}>
                    <Play className={classes(ICON.sm, COLOR.onMediaFill)} />
                  </div>
                )}
                <div className={classes(CELL_SCRIM, GAP[4])}>
                  <div className={classes('flex items-center', GAP[1])}>
                    <Heart className={classes(ICON.md, COLOR.onMediaFill)} />
                    <span>{post.like_count || 0}</span>
                  </div>
                  <div className={classes('flex items-center', GAP[1])}>
                    <MessageCircle className={classes(ICON.md, COLOR.onMediaFill)} />
                    <span>{post.comment_count || 0}</span>
                  </div>
                </div>
              </div>
            ))}
            {displayPosts.length === 0 && (
              <div className={EMPTY_CELL}>
                No posts yet
              </div>
            )}
          </div>
        )}

        {profileTab === 'saved' && (
          <div className={CELL_GRID}>
            {(savedPosts && savedPosts.length > 0 ? savedPosts : []).map((post) => (
              <div
                key={post.id}
                data-post-id={post.id}
                onClick={() => {
                  playPress(700);
                  openPost(post);
                }}
                className={GRID_CELL}
              >
                <ObjectImage
                  objectId={post.id}
                  contentUrl={post.url}
                  identity={identity}
                  mimeType={post.mime_type}
                  alt=""
                  className={CELL_IMG}
                  videoClassName={CELL_IMG}
                  muted
                  autoPlay={false}
                  playsInline
                />
                {videoPostIds.has(post.id) && (
                  <div className={VIDEO_CHIP}>
                    <Play className={classes(ICON.sm, COLOR.onMediaFill)} />
                  </div>
                )}
                <div className={CELL_SCRIM}>
                  <Bookmark className={classes(ICON.lg, COLOR.onMediaFill)} />
                </div>
              </div>
            ))}
            {(!savedPosts || savedPosts.length === 0) && (
              <div className={EMPTY_CELL}>
                No saved posts
              </div>
            )}
          </div>
        )}

        {profileTab === 'reposts' && (
          <div className={CELL_GRID}>
            {(repostPosts && repostPosts.length > 0 ? repostPosts : []).map((post) => (
              <div
                key={post.id}
                onClick={() => {
                  playPress(700);
                  openPost(post);
                }}
                className={GRID_CELL}
              >
                <ObjectImage
                  contentUrl={post.url}
                  objectId={post.id}
                  identity={identity}
                  mimeType={post.mime_type}
                  alt=""
                  className={CELL_IMG}
                  videoClassName={CELL_IMG}
                  muted
                  autoPlay={false}
                  playsInline
                />
                {videoPostIds.has(post.id) && (
                  <div className={VIDEO_CHIP}>
                    <Play className={classes(ICON.sm, COLOR.onMediaFill)} />
                  </div>
                )}
                <div className={classes(CELL_SCRIM, PRESENCE.currentText)}>
                  <Repeat className="w-5 h-5" />
                </div>
              </div>
            ))}
            {repostPosts.length === 0 && (
              <div className={EMPTY_CELL}>
                No reposts yet
              </div>
            )}
          </div>
        )}

        {profileTab === 'cards' && (
          <div className={CELL_GRID}>
            {cards.slice(0, 12).map((card) => (
              <div
                key={card.id}
                onClick={() => openCardDetail(card)}
                className={GRID_CELL}
              >
                <ObjectImage
                  contentUrl={card.content_url || (card as any).data || (card as any).url || `/api/objects/${card.id}`}
                  objectId={card.id}
                  identity={identity}
                  mimeType={card.mime_type}
                  alt=""
                  className={CELL_IMG}
                  videoClassName={CELL_IMG}
                  muted
                  autoPlay={false}
                  playsInline
                />
                {videoCardIds.has(card.id) && (
                  <div className={VIDEO_CHIP}>
                    <Play className={classes(ICON.sm, COLOR.onMediaFill)} />
                  </div>
                )}
              </div>
            ))}
            {cards.length === 0 && (
              <div className={EMPTY_CELL}>
                No cards yet
              </div>
            )}
          </div>
        )}
      </div>

      {/* Profile Picture Modal */}
      {showPfpModal && (
        <ProfilePicModal
          isOpen={showPfpModal}
          currentPfp={pfp}
          onClose={() => setShowPfpModal(false)}
          onSave={(newPfp) => {
            void handleSavePfp(newPfp);
          }}
          toast={toast}
        />
      )}

      {/* Profile Editor Modal */}
      {showEditor && (
        <ProfileEditorModal
          identity={identity}
          initialName={displayName}
          initialBio={bio}
          initialWebsite={website}
          initialPfp={pfp}
          initialTags={profileTags}
          onClose={() => setShowEditor(false)}
          onProfileUpdated={(updated) => {
            setDisplayName(updated.name);
            setBio(updated.bio);
            setWebsite(updated.website);
            if (updated.pfpUrl) setPfp(updated.pfpUrl);
            onProfileUpdated?.(updated);
          }}
          toast={toast}
        />
      )}

      {/* Share / options / likers sheets for the expanded post */}
      {postLightboxModals}
    </div>
  );
}
