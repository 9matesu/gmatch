"use client";

import { useCallback, useState } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import { playPress, playMsgReceive } from '../../utils/sounds';
import { postShareUrl } from '../../utils/api';
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
  const [sharingPost, setSharingPost] = useState<FeedPost | null>(null);
  const [optionsPost, setOptionsPost] = useState<FeedPost | null>(null);
  const [likersPostId, setLikersPostId] = useState<string | null>(null);

  const openPost = useCallback((post: FeedPost) => {
    setLiked((prev) => (prev[post.id] === undefined ? { ...prev, [post.id]: !!post.is_liked } : prev));
    setSaved((prev) => (prev[post.id] === undefined ? { ...prev, [post.id]: !!post.is_saved } : prev));
    setCounts((prev) => (prev[post.id] === undefined ? { ...prev, [post.id]: post.like_count ?? 0 } : prev));
    setCommentsMap((prev) =>
      prev[post.id] === undefined ? { ...prev, [post.id]: post.comments || [] } : prev,
    );
    setActivePost(post);
  }, []);

  const closePost = useCallback(() => setActivePost(null), []);

  const toggleLike = useCallback(
    (post: FeedPost) => {
      playPress(820);
      setLiked((prev) => {
        const next = !prev[post.id];
        setCounts((c) => ({ ...c, [post.id]: Math.max(0, (c[post.id] ?? 0) + (next ? 1 : -1)) }));
        onPersistLike?.(post.id, next).then((count) => {
          if (typeof count === 'number') setCounts((c) => ({ ...c, [post.id]: count }));
        });
        return { ...prev, [post.id]: next };
      });
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
      const comment: PostComment = {
        id: `c_${Date.now()}`,
        author_id: identity?.orbitId || 'me',
        author_name: 'You',
        author_avatar: profilePics[identity?.orbitId || ''],
        text,
        created_at: 'Just now',
        like_count: 0,
      };
      setCommentsMap((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), comment] }));
      toast?.('Comment posted!', 'success');
      onPersistComment?.(postId, text).then((serverComment) => {
        if (serverComment) {
          setCommentsMap((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).map((c) => (c.id === comment.id ? serverComment : c)),
          }));
        }
      });
    },
    [identity, profilePics, onPersistComment, toast],
  );

  const handleToggleCommentLike = useCallback((postId: string, commentId: string) => {
    playPress(850);
    setCommentsMap((prev) => ({
      ...prev,
      [postId]: (prev[postId] || []).map((c) =>
        c.id === commentId
          ? { ...c, is_liked: !c.is_liked, like_count: c.like_count + (c.is_liked ? -1 : 1) }
          : c,
      ),
    }));
  }, []);

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
