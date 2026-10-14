"use client";

import { useCallback, useRef, useState } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import { createLikeGovernor, type LikeGovernor } from '../../utils/likeReconcile';
import { playPress, playMsgReceive } from '../../utils/sounds';
import { orbitFetch, postShareUrl } from '../../utils/api';
import { InstagramPostModal } from './InstagramPostModal';
import { SharePostModal } from './SharePostModal';
import { PostOptionsModal } from './PostOptionsModal';
import { PostLikersModal } from './PostLikersModal';
import type { FeedPost, PostComment } from './GMatchFeed';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

export interface ProfileLightboxDeps {
  identity: OrbitIdentity | null;
  profilePics?: Record<string, string>;
  users?: Array<{ id: string; display_name?: string }>;
  followingIds?: string[];
  shareGroups?: { id: string; name: string; member_count: number }[];
  toast?: ToastFn;
  onPersistLike?: (postId: string, liked: boolean) => Promise<number | undefined>;
  onPersistSave?: (postId: string, saved: boolean) => void;
  onPersistComment?: (postId: string, text: string) => Promise<PostComment | null>;
  onSendDm?: (peerId: string, text: string) => Promise<boolean>;
  onSelectUser?: (userId: string) => void;
  onAvatarClick?: (userId: string) => void;
  onOpenNetwork?: (userId: string) => void;
  onCopyLink?: (post: FeedPost) => void;
  onArchivePost?: (postId: string) => void;
  onDeletePost?: (postId: string) => void;
  onReportPost?: (post: FeedPost) => void;
  /** Stacking override for lightboxes nested inside higher-z overlays
   *  (e.g. UserProfileModal at z-system). Defaults to z-modal. */
  zIndexClass?: string;
}

/**
 * Fully-wired post lightbox suite for profile surfaces (own profile grid,
 * other-user profile modal). Mirrors the GMatchFeed lightbox behavior —
 * like/save/comment/share/options/likers all live — so profile grids never
 * open a dead modal. Local optimistic state reconciles with the optional
 * App-level persist callbacks.
 */
export function useProfilePostLightbox(deps: ProfileLightboxDeps) {
  const {
    identity,
    profilePics = {},
    users = [],
    followingIds = [],
    shareGroups = [],
    toast,
    onPersistLike,
    onPersistSave,
    onPersistComment,
    onSendDm,
    onSelectUser,
    onAvatarClick,
    onOpenNetwork,
    onCopyLink,
    onArchivePost,
    onDeletePost,
    onReportPost,
    zIndexClass,
  } = deps;

  const [activePost, setActivePost] = useState<FeedPost | null>(null);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [commentsMap, setCommentsMap] = useState<Record<string, PostComment[]>>({});
  const [commentsLoadingId, setCommentsLoadingId] = useState<string | null>(null);
  const [sharingPost, setSharingPost] = useState<FeedPost | null>(null);
  const [optionsPost, setOptionsPost] = useState<FeedPost | null>(null);
  const [likersPostId, setLikersPostId] = useState<string | null>(null);
  // Fresh reads for the governor without recreating the toggle on every
  // keystroke elsewhere in the tree (same pattern as the feed version, which
  // instead re-creates the callback from render-scope state).
  const likedRef = useRef(liked);
  likedRef.current = liked;
  const countsRef = useRef(counts);
  countsRef.current = counts;
  // Same single-flight governor as the feed toggle (see utils/likeReconcile):
  // persist runs once per gesture outside any updater, stale resolutions are
  // discarded by generation, failures roll back.
  const likeGov = useRef<LikeGovernor | null>(null);
  if (!likeGov.current) {
    likeGov.current = createLikeGovernor({
      setLiked: (id, v) => setLiked((prev) => ({ ...prev, [id]: v })),
      setCount: (id, n) => setCounts((c) => ({ ...c, [id]: n })),
    });
  }

  const openPost = useCallback(
    (post: FeedPost) => {
      setLiked((prev) => (prev[post.id] === undefined ? { ...prev, [post.id]: !!post.is_liked } : prev));
      setSaved((prev) => (prev[post.id] === undefined ? { ...prev, [post.id]: !!post.is_saved } : prev));
      setCounts((prev) => (prev[post.id] === undefined ? { ...prev, [post.id]: post.like_count ?? 0 } : prev));
      setActivePost(post);
      // The profile endpoints don't inline comments (post.comments is only
      // populated on the single-post route, which the app never calls), so
      // seeding from it left every profile lightbox permanently empty. Fetch
      // the list the same way the feed does.
      if (!identity) return;
      let cancelled = false;
      setCommentsLoadingId(post.id);
      orbitFetch(`/api/posts/${post.id}/comments`, {}, identity)
        .then(async (res) => {
          if (cancelled || !res.ok) return;
          const list = await res.json();
          if (cancelled || !Array.isArray(list)) return;
          setCommentsMap((prev) => ({ ...prev, [post.id]: list }));
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setCommentsLoadingId(null);
        });
      return () => {
        cancelled = true;
      };
    },
    [identity],
  );

  const closePost = useCallback(() => setActivePost(null), []);

  const toggleLike = useCallback(
    (post: FeedPost) => {
      playPress(820);
      likeGov.current!.toggle(
        post.id,
        !!likedRef.current[post.id],
        countsRef.current[post.id] ?? post.like_count ?? 0,
        { persist: onPersistLike ?? undefined },
      );
    },
    [onPersistLike],
  );

  const toggleSave = useCallback(
    (post: FeedPost) => {
      playPress(740);
      setSaved((prev) => {
        const next = !prev[post.id];
        toast?.(next ? 'Post saved to your collection' : 'Removed from saved', 'info');
        onPersistSave?.(post.id, next);
        return { ...prev, [post.id]: next };
      });
    },
    [onPersistSave, toast],
  );

  const handleAddComment = useCallback(
    (postId: string, textToAdd?: string) => {
      const text = (textToAdd || '').trim();
      if (!text) return;
      playMsgReceive();
      const draftId = `c_pending_${Date.now()}`;
      const comment: PostComment = {
        id: draftId,
        author_id: identity?.orbitId || 'me',
        author_name: 'You',
        author_avatar: profilePics[identity?.orbitId || ''],
        text,
        created_at: new Date().toISOString(),
        like_count: 0,
        pending: true,
      };
      setCommentsMap((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), comment] }));

      const persist = onPersistComment?.(postId, text);
      if (!persist) {
        setCommentsMap((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).map((c) => (c.id === draftId ? { ...c, pending: false } : c)),
        }));
        return;
      }
      void persist
        .then((serverComment) => {
          if (serverComment) {
            setCommentsMap((prev) => ({
              ...prev,
              [postId]: (prev[postId] || []).map((c) =>
                c.id === draftId ? { ...serverComment, pending: false } : c,
              ),
            }));
          } else {
            setCommentsMap((prev) => ({
              ...prev,
              [postId]: (prev[postId] || []).filter((c) => c.id !== draftId),
            }));
            toast?.('Comment not saved — try again', 'error');
          }
        })
        .catch(() => {
          setCommentsMap((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).filter((c) => c.id !== draftId),
          }));
          toast?.('Comment not saved — try again', 'error');
        });
    },
    [identity, profilePics, onPersistComment, toast],
  );

  // Like-only server route (no unlike endpoint), so no local toggle.
  const handleToggleCommentLike = useCallback(
    (postId: string, commentId: string) => {
      const target = (commentsMap[postId] || []).find((c) => c.id === commentId);
      if (!target || target.pending || target.is_liked || !identity) return;
      playPress(850);
      void orbitFetch(`/api/posts/${postId}/comments/${commentId}/like`, { method: 'POST' }, identity)
        .then(async (res) => {
          if (!res.ok) throw new Error(`like failed: ${res.status}`);
          const data = await res.json().catch(() => null);
          setCommentsMap((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).map((c) =>
              c.id === commentId
                ? { ...c, is_liked: true, like_count: Number(data?.like_count ?? c.like_count + 1) }
                : c,
            ),
          }));
        })
        .catch(() => toast?.('Could not like that comment', 'error'));
    },
    [commentsMap, identity, toast],
  );

  const handleCopyLink = useCallback(
    (post: FeedPost) => {
      playPress(800);
      if (onCopyLink) {
        onCopyLink(post);
      } else {
        void navigator.clipboard?.writeText(postShareUrl(post.id));
        toast?.('Post link copied to clipboard!', 'success');
      }
      setOptionsPost(null);
    },
    [onCopyLink, toast],
  );

  const handleReport = useCallback(
    (post: FeedPost) => {
      if (onReportPost) {
        onReportPost(post);
      } else {
        toast?.('Thanks. Our team will review this post.', 'info');
      }
      setOptionsPost(null);
    },
    [onReportPost, toast],
  );

  const handleAvatar = useCallback(
    (userId: string) => {
      setActivePost(null);
      setLikersPostId(null);
      if (onAvatarClick) onAvatarClick(userId);
      else onSelectUser?.(userId);
    },
    [onAvatarClick, onSelectUser],
  );

  const userNames = Object.fromEntries(users.map((u) => [u.id, u.display_name || '']));

  const modals = (
    <>
      <InstagramPostModal
        isOpen={!!activePost}
        post={activePost}
        onClose={closePost}
        identity={identity}
        profilePics={profilePics}
        isLiked={activePost ? !!liked[activePost.id] : false}
        isSaved={activePost ? !!saved[activePost.id] : false}
        likeCount={activePost ? counts[activePost.id] ?? activePost.like_count ?? 0 : 0}
        comments={activePost ? commentsMap[activePost.id] || [] : []}
        commentsLoading={!!activePost && commentsLoadingId === activePost.id}
        onToggleLike={toggleLike}
        onToggleSave={toggleSave}
        onAddComment={handleAddComment}
        onToggleCommentLike={handleToggleCommentLike}
        onOpenShare={(p) => {
          setActivePost(null);
          setSharingPost(p);
        }}
        onOptionsClick={(p) => {
          setActivePost(null);
          setOptionsPost(p);
        }}
        onOpenLikers={(postId) => setLikersPostId(postId)}
        onSelectUser={handleAvatar}
        onAvatarClick={handleAvatar}
        onOpenNetwork={
          onOpenNetwork
            ? (uId) => {
                setActivePost(null);
                onOpenNetwork(uId);
              }
            : undefined
        }
        toast={toast}
        zIndexClass={zIndexClass}
      />
      {sharingPost && (
        <SharePostModal
          post={sharingPost}
          onClose={() => setSharingPost(null)}
          followingIds={followingIds}
          profilePics={profilePics}
          userNames={userNames}
          identity={identity}
          toast={toast}
          groups={shareGroups}
          onSendDm={onSendDm}
          zIndexClass={zIndexClass}
        />
      )}
      {optionsPost && (
        <PostOptionsModal
          post={optionsPost}
          onClose={() => setOptionsPost(null)}
          identityOrbitId={identity?.orbitId}
          onShare={(p) => setSharingPost(p)}
          onCopyLink={handleCopyLink}
          onArchive={(id) => {
            onArchivePost?.(id);
            setOptionsPost(null);
          }}
          onDelete={(id) => {
            onDeletePost?.(id);
            setOptionsPost(null);
          }}
          onReport={handleReport}
          toast={toast}
          zIndexClass={zIndexClass}
        />
      )}
      {likersPostId && (
        <PostLikersModal
          postId={likersPostId}
          isOpen={!!likersPostId}
          onClose={() => setLikersPostId(null)}
          identity={identity}
          profilePics={profilePics}
          onSelectUser={(userId) => {
            setLikersPostId(null);
            setActivePost(null);
            handleAvatar(userId);
          }}
          toast={toast}
          zIndexClass={zIndexClass}
        />
      )}
    </>
  );

  return { activePost, openPost, closePost, modals };
}
