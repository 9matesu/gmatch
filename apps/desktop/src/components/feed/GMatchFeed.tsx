"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCropper } from '../../hooks/useCropper';
import { playPress, playWin, playMsgReceive } from '../../utils/sounds';
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
  Sparkles,
  Repeat,
  Camera,
  PlusSquare,
  Coffee,
  Swords,
  Trophy,
  ShoppingBag,
  Flame,
  Gamepad2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject as StoryItem } from '@orbit/shared';
import { GMatchStories } from '../GMatchStories';
import { InstagramPostModal } from './InstagramPostModal';
import { LiveCameraModal } from '../camera/LiveCameraModal';
import { ObjectImage } from '../ObjectImage';
import { LazyVideo } from '../LazyVideo';
import { isMediaVideo, resolveMediaUrl } from '../../utils/media';
import { orbitFetch, postShareUrl } from '../../utils/api';
import { GAME_AD_TEMPLATES } from '../../utils/gameAds';
import { ExploreSearchModal } from './ExploreSearchModal';
import { useNow } from '../../hooks/useNow';
import { SharePostModal } from './SharePostModal';
import { CommentsModal } from './CommentsModal';
import { PostOptionsModal } from './PostOptionsModal';
import { ReportPostModal } from './ReportPostModal';
import { PostCreatorModal } from './PostCreatorModal';
import { FeedHeader } from './FeedHeader';

export interface PostComment {
  id: string;
  author_id: string;
  author_name: string;
  author_avatar?: string | null;
  text: string;
  created_at: string;
  like_count: number;
  is_liked?: boolean;
}

export interface FeedPost {
  id: string;
  author_id: string;
  author_name: string;
  author_avatar?: string | null;
  url: string;
  mime_type?: string;
  mediaUrls?: string[];
  media?: { id: string; url: string; mime_type: string }[];
  caption?: string;
  location?: string;
  tags?: string[];
  created_at: string;
  like_count: number;
  comment_count: number;
  share_count?: number;
  is_liked?: boolean;
  is_saved?: boolean;
  is_reposted?: boolean;
  reposted_by?: string;
  is_archived?: boolean;
  comments?: PostComment[];
  is_sponsored?: boolean;
  game_mode?: 'duel' | 'babecock' | 'ranks' | 'store' | 'discord' | 'coffee';
  players_playing?: number;
  cta_label?: string;
}

export const PRESET_CHAT_GROUPS = [
  { id: 'group_general', name: 'General Lounge', icon: 'general', desc: 'Main public community' },
  { id: 'group_arcade', name: 'Arcade Duelists', icon: 'arcade', desc: 'Card game matchmaking' },
  { id: 'group_anime', name: 'Anime Syndicate', icon: 'anime', desc: 'Art & Booru showcase' },
];

const AD_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  discord: MessageCircle,
  coffee: Coffee,
  duel: Swords,
  babecock: Flame,
  ranks: Trophy,
  store: ShoppingBag,
}

/**
 * LCP-critical first feed image. Object-backed posts normally render via a
 * signed JS fetch → blob URL, which the browser cannot prioritise. Instead we
 * mint a one-time signed URL (GET /api/objects/:id/signed-url) and let the
 * <img> load it directly with fetchpriority=high + eager so the largest paint
 * happens as early as possible. Falls back to ObjectImage if the mint fails.
 */
function SignedPostImage({
  id,
  url,
  identity,
  alt,
  className,
}: {
  id: string
  url?: string | null
  identity: OrbitIdentity | null
  alt?: string
  className?: string
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSignedUrl(null)
    if (!id) return
    // Only attempt signed URL fetch when identity is available (for auth-protected objects)
    // For public objects, the regular /api/objects/:id endpoint with CORS works fine
    if (!identity) return
    orbitFetch(`/api/objects/${id}/signed-url`, { method: 'GET' }, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url?: string } | null) => {
        if (!cancelled && d?.url) setSignedUrl(d.url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, identity])

  if (signedUrl) {
    return (
      <img
        src={resolveMediaUrl(signedUrl)}
        alt={alt || 'Post image'}
        className={className}
        loading="eager"
        fetchPriority="high"
        draggable={false}
        crossOrigin="use-credentials"
      />
    )
  }
  return (
    <ObjectImage
      contentUrl={url}
      objectId={id}
      identity={identity}
      alt={alt}
      className={className}
      videoClassName={className}
      loading="eager"
      fetchPriority="high"
    />
  )
}

export function GMatchFeed({
  identity,
  posts,
  stories,
  storiesLoading = false,
  followingIds = [],
  profilePics = {},
  users = [],
  onAddStory,
  onOpenStory,
  activeStoryUserId = null,
  onActiveStoryClose,
  onOpenDMs,
  onOpenPostCreator,
  onSelectUser,
  onToggleTools,
  onOpenGameAd,
  onStartPm,
  onPersistLike,
  onPersistSave,
  onPersistComment,
  onPersistReport,
  onReportComment,
  onPublishPost,
  onDeletePostApi,
  onDeletePost,
  onArchivePost,
  onRepostPost,
  onLoadMore,
  hasMore = true,
  isLoadingMore = false,
  feedSort = 'latest',
  onFeedSortChange,
  feedCols = '1',
  onFeedColsChange,
  toast,
  unreadCount = 0,
  onRefreshNotifications,
  onOpenNotifications,
  onOpenNetwork,
  onUserContext,
}: {
  identity: OrbitIdentity | null;
  posts: FeedPost[];
  stories: StoryItem[];
  storiesLoading?: boolean;
  followingIds?: string[];
  profilePics?: Record<string, string>;
  users?: Array<{ id: string; display_name?: string; orbitId?: string; pfp_url?: string | null }>;
  onAddStory?: () => void;
  onOpenStory?: (userId: string) => void;
  activeStoryUserId?: string | null;
  onActiveStoryClose?: () => void;
  onOpenDMs?: () => void;
  onOpenPostCreator?: () => void;
  onSelectUser?: (userId: string) => void;
  onToggleTools?: () => void;
  onOpenGameAd?: (mode: 'duel' | 'babecock' | 'ranks' | 'store' | 'discord' | 'coffee') => void;
  onStartPm?: (user: { id: string; display_name?: string }) => void;
  onPersistLike?: (postId: string, liked: boolean) => Promise<number | undefined>;
  onPersistSave?: (postId: string, saved: boolean) => void;
  onPersistComment?: (postId: string, text: string) => Promise<PostComment | null>;
  onPersistReport?: (postId: string, reason: string) => void;
  onReportComment?: (commentId: string) => void;
  onPublishPost?: (mediaUrls: string[], caption: string, tags: string[]) => Promise<boolean>;
  onDeletePostApi?: (postId: string) => void;
  onDeletePost?: (postId: string) => void;
  onArchivePost?: (postId: string) => void;
  onRepostPost?: (post: FeedPost) => void;
  onLoadMore?: () => Promise<void | boolean>;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  feedSort?: 'latest' | 'trending';
  onFeedSortChange?: (sort: 'latest' | 'trending') => void;
  feedCols?: '1' | '2' | '3' | '4' | '5';
  onFeedColsChange?: (cols: '1' | '2' | '3' | '4' | '5') => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  unreadCount?: number;
  onRefreshNotifications?: () => void;
  onOpenNotifications?: () => void;
  onOpenNetwork?: (userId: string) => void;
  onUserContext?: (e: React.MouseEvent, userId: string, displayName: string) => void;
}) {
  const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({});
  const [savedPosts, setSavedPosts] = useState<Record<string, boolean>>({});
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [doubleTapAnimationId, setDoubleTapAnimationId] = useState<string | null>(null);
  const [mediaIdx, setMediaIdx] = useState<Record<string, number>>({});
  const [internalLoadingMore, setInternalLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const now = useNow(60_000);
  const storyOwners = useMemo(() => {
    const owners = new Set<string>();
    for (const story of stories || []) {
      const ownerId = story.owner_id || (story as any).user_id;
      if (ownerId) owners.add(ownerId);
    }
    return owners;
  }, [stories]);

  // Endless scroll observer
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !internalLoadingMore && !isLoadingMore && hasMore !== false) {
          if (onLoadMore) {
            setInternalLoadingMore(true);
            Promise.resolve(onLoadMore()).finally(() => {
              setInternalLoadingMore(false);
            });
          }
        }
      },
      { rootMargin: '600px' }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [internalLoadingMore, isLoadingMore, hasMore, onLoadMore]);

  // Modals State
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showExploreSearch, setShowExploreSearch] = useState(false);
  const [activeLightboxPost, setActiveLightboxPost] = useState<FeedPost | null>(null);
  const [showCustomPostCreator, setShowCustomPostCreator] = useState(false);

  // Post Creator State (Multi-media + optional tags)
  const [postCreatorMedia, setPostCreatorMedia] = useState<string[]>([]);
  const { crop: cropCameraShot, cropper: cameraCropper } = useCropper();
  const [postCreatorCaption, setPostCreatorCaption] = useState('');
  const [postCreatorTags, setPostCreatorTags] = useState<string[]>([]);

  // Tag Affinities Steering Engine
  const [tagAffinities, setTagAffinities] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('goonMatch_tag_affinities');
        if (saved) return JSON.parse(saved);
      } catch { }
    }
    return { anime: 3, cyberpunk: 3, waifu: 2, '1girl': 2 };
  });

  // Comments State (No mockups)
  const [activeCommentsPostId, setActiveCommentsPostId] = useState<string | null>(null);
  const [commentsMap, setCommentsMap] = useState<Record<string, PostComment[]>>({});

  // Share Modal State
  const [sharingPost, setSharingPost] = useState<FeedPost | null>(null);

  // Deep link: #/feed?post=<id> (from share/permalink) opens the post lightbox
  // once the post is loaded. One-shot — later list changes don't reopen it.
  const deepLinkDoneRef = useRef(false);
  useEffect(() => {
    if (deepLinkDoneRef.current || posts.length === 0) return;
    const m = /post=([\w-]+)/.exec(window.location.hash);
    if (!m) return;
    const target = posts.find((p) => p.id === m[1]);
    if (target) {
      deepLinkDoneRef.current = true;
      setActiveLightboxPost(target);
    }
  }, [posts]);

  // Post Options Modal State
  const [optionsPost, setOptionsPost] = useState<FeedPost | null>(null);
  const [reportingPost, setReportingPost] = useState<FeedPost | null>(null);

  const handleAvatarClick = (userId: string) => {
    playPress(750);
    const hasStories = storyOwners.has(userId);
    if (hasStories) {
      onOpenStory?.(userId);
    } else {
      onSelectUser?.(userId);
    }
  };

  // Initialize likes/saves and comments state (without fake mock comments)
  useEffect(() => {
    const initialLikes: Record<string, boolean> = {};
    const initialCounts: Record<string, number> = {};
    const initialSaves: Record<string, boolean> = {};
    const initialComments: Record<string, PostComment[]> = {};

    posts.forEach((p) => {
      if (p.is_liked) initialLikes[p.id] = true;
      initialCounts[p.id] = p.like_count ?? 0;
      if (p.is_saved) initialSaves[p.id] = true;
      if (p.comments && p.comments.length > 0) {
        initialComments[p.id] = p.comments;
      }
    });

    setLikedPosts((prev) => ({ ...initialLikes, ...prev }));
    setLikeCounts((prev) => ({ ...initialCounts, ...prev }));
    setSavedPosts((prev) => ({ ...initialSaves, ...prev }));
    setCommentsMap((prev) => ({ ...initialComments, ...prev }));
  }, [posts]);

  const boostTagAffinity = useCallback((tags?: string[]) => {
    if (!tags || tags.length === 0) return;
    setTagAffinities((prev) => {
      const next = { ...prev };
      tags.forEach((t) => {
        const clean = t.toLowerCase().replace(/^#/, '');
        next[clean] = (next[clean] || 0) + 1;
      });
      try {
        localStorage.setItem('goonMatch_tag_affinities', JSON.stringify(next));
      } catch { }
      return next;
    });
  }, []);

  // Track the post ids that newly appeared at the top of the feed so they get a
  // single entrance animation once, then render normally.
  const prevPostIdsRef = useRef<Set<string> | null>(null);
  const [animatedPostIds, setAnimatedPostIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const current = new Set(posts.map((p) => p.id));
    const prev = prevPostIdsRef.current;
    prevPostIdsRef.current = current;
    if (!prev || prev.size === 0) return;
    const fresh: string[] = [];
    current.forEach((id) => {
      if (!prev.has(id)) fresh.push(id);
    });
    if (fresh.length > 0) {
      setAnimatedPostIds((existing) => {
        const next = new Set(existing);
        fresh.forEach((id) => next.add(id));
        return next;
      });
      // Clear the animation marker so the same post can animate again if it is
      // re-inserted (e.g. after a re-post) without leaking forever.
      const timer = setTimeout(() => {
        setAnimatedPostIds((existing) => {
          const next = new Set(existing);
          fresh.forEach((id) => next.delete(id));
          return next;
        });
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [posts]);

  // Algorithmic Sorting. Latest is strictly chronological; Trending is a
  // deterministic engagement + tag-affinity score with recency decay, matching
  // the server's scoring intent (see /api/posts).
  const displayPosts = useMemo(() => {
    const active = posts.filter((p) => !p.is_archived);

    if (feedSort === 'latest') {
      return [...active].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    return [...active].sort((a, b) => {
      const ageHoursA = Math.max(1, (now - new Date(a.created_at).getTime()) / (1000 * 60 * 60));
      const ageHoursB = Math.max(1, (now - new Date(b.created_at).getTime()) / (1000 * 60 * 60));

      const likesA = likeCounts[a.id] ?? a.like_count ?? 0;
      const likesB = likeCounts[b.id] ?? b.like_count ?? 0;
      const commentsA = (commentsMap[a.id]?.length || a.comment_count || 0);
      const commentsB = (commentsMap[b.id]?.length || b.comment_count || 0);

      let tagScoreA = 0;
      let tagScoreB = 0;
      if (a.tags) {
        a.tags.forEach((t) => { tagScoreA += tagAffinities[t.toLowerCase()] || 0; });
      }
      if (b.tags) {
        b.tags.forEach((t) => { tagScoreB += tagAffinities[t.toLowerCase()] || 0; });
      }

      const scoreA = (likesA * 2 + commentsA * 3 + tagScoreA * 4) / Math.pow(ageHoursA, 0.6);
      const scoreB = (likesB * 2 + commentsB * 3 + tagScoreB * 4) / Math.pow(ageHoursB, 0.6);
      if (scoreA !== scoreB) return scoreB - scoreA;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [posts, likeCounts, commentsMap, tagAffinities, now, feedSort]);

  const toggleLike = useCallback((post: FeedPost) => {
    playPress(820);
    setLikedPosts((prev) => {
      const isCurrentlyLiked = !!prev[post.id];
      const next = !isCurrentlyLiked;
      setLikeCounts((counts) => ({
        ...counts,
        [post.id]: Math.max(0, (counts[post.id] ?? 0) + (next ? 1 : -1)),
      }));
      if (next) boostTagAffinity(post.tags);
      if (post.is_sponsored) return { ...prev, [post.id]: next };
      // Persist server-side; reconcile the authoritative count when it comes back.
      onPersistLike?.(post.id, next).then((count) => {
        if (typeof count === 'number') {
          setLikeCounts((counts) => ({ ...counts, [post.id]: count }));
        }
      });
      return { ...prev, [post.id]: next };
    });
  }, [boostTagAffinity, onPersistLike]);

  const handleDoubleTap = (post: FeedPost) => {
    playWin();
    if (!likedPosts[post.id]) {
      toggleLike(post);
    }
    setDoubleTapAnimationId(post.id);
    setTimeout(() => {
      setDoubleTapAnimationId(null);
    }, 700);
  };

  const toggleSave = (post: FeedPost) => {
    playPress(740);
    setSavedPosts((prev) => {
      const next = !prev[post.id];
      toast?.(next ? 'Post saved to your collection' : 'Removed from saved', 'info');
      if (next) boostTagAffinity(post.tags);
      if (!post.is_sponsored) onPersistSave?.(post.id, next);
      return { ...prev, [post.id]: next };
    });
  };

  const handleAddComment = (postId: string, textToAdd?: string) => {
    const text = (textToAdd || '').trim();
    if (!text) return;
    playMsgReceive();
    const newComment: PostComment = {
      id: `c_${Date.now()}`,
      author_id: identity?.orbitId || 'me',
      author_name: 'You',
      author_avatar: profilePics[identity?.orbitId || ''],
      text,
      created_at: 'Just now',
      like_count: 0,
    };

    setCommentsMap((prev) => ({
      ...prev,
      [postId]: [...(prev[postId] || []), newComment],
    }));

    const post = posts.find((p) => p.id === postId);
    if (post) boostTagAffinity(post.tags);

    toast?.('Comment posted!', 'success');

    if (!post?.is_sponsored) {
      onPersistComment?.(postId, text).then((serverComment) => {
        if (serverComment) {
          setCommentsMap((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).map((c) =>
              c.id === newComment.id ? serverComment : c
            ),
          }));
        }
      });
    }
  };

  const handleToggleCommentLike = (postId: string, commentId: string) => {
    playPress(850);
    setCommentsMap((prev) => {
      const list = prev[postId] || [];
      return {
        ...prev,
        [postId]: list.map((c) =>
          c.id === commentId
            ? { ...c, is_liked: !c.is_liked, like_count: c.like_count + (c.is_liked ? -1 : 1) }
            : c
        ),
      };
    });
  };

  const handleCopyLink = (post: FeedPost) => {
    playPress(800);
    void navigator.clipboard.writeText(postShareUrl(post.id));
    toast?.('Post link copied to clipboard!', 'success');
    setOptionsPost(null);
  };

  const activeCommentsPost = useMemo(() => {
    if (!activeCommentsPostId) return null;
    return posts.find((p) => p.id === activeCommentsPostId) || null;
  }, [activeCommentsPostId, posts]);

  // Fetch persisted comments whenever a post's comment modal is opened
  useEffect(() => {
    if (!activeCommentsPostId || !identity) return;
    orbitFetch(`/api/posts/${activeCommentsPostId}/comments`, {}, identity)
      .then(async (res) => {
        if (!res.ok) return;
        const list = await res.json();
        if (Array.isArray(list)) {
          setCommentsMap((prev) => ({
            ...prev,
            [activeCommentsPostId]: list,
          }));
        }
      })
      .catch(() => {});
  }, [activeCommentsPostId, identity]);

  return (
    <div className="w-full flex flex-col font-sans select-none pb-12 text-retro-fg">
      {/* Stories Tray Carousel — topmost section of the feed */}
      <div className="bg-transparent border-b border-border-glass py-3 px-1">
        <GMatchStories
          stories={stories}
          loading={storiesLoading}
          currentUserId={identity?.orbitId || ''}
          identity={identity}
          activeUserId={activeStoryUserId}
          onCloseActiveUser={onActiveStoryClose || (() => {})}
          onAddStory={onAddStory || (() => setShowCameraModal(true))}
          profilePics={profilePics}
          onStartPm={onStartPm}
        />
      </div>

      {/* Feed Top Header - Seamless, 0 upper gap, sticky with navigation */}
      <FeedHeader
        unreadCount={unreadCount}
        onOpenCamera={() => setShowCameraModal(true)}
        onCreatePost={() => {
          if (onOpenPostCreator) onOpenPostCreator();
          else setShowCustomPostCreator(true);
        }}
        onToggleTools={onToggleTools}
        onOpenSearch={() => setShowExploreSearch(true)}
        onOpenNotifications={() => {
          if (onOpenNotifications) onOpenNotifications();
          onRefreshNotifications?.();
        }}
        onOpenDMs={onOpenDMs}
      />

      {/* Feed Content Column (Posts) */}
      <div className="w-full max-w-[1400px] mx-auto flex flex-col px-2 sm:px-4 py-2 space-y-4">
        {/* Feed Sort / Filter Bar */}
        <div className="flex items-center justify-between px-3 sm:px-6 py-2 gap-2 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm sticky top-[57px] z-20">
          <div className="flex items-center gap-1 text-xs">
            {(['latest', 'trending'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => { playPress(720); onFeedSortChange?.(mode); }}
                className={`px-3 py-1.5 rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer font-medium ${feedSort === mode
                    ? 'bg-zinc-800 text-zinc-100 shadow-xs border border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-200'
                  }`}
              >
                {mode === 'latest' ? 'Latest' : 'Trending'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400">
              {displayPosts.length} posts
            </span>
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-md p-0.5 text-xs">
              {(['1', '2', '3', '4', '5'] as const).map((cols) => (
                <button
                  key={cols}
                  type="button"
                  onClick={() => { playPress(720); onFeedColsChange?.(cols); }}
                  className={`px-2 py-1 rounded transition-all duration-150 active:scale-[0.96] cursor-pointer font-medium ${feedCols === cols
                      ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  title={`${cols}-column feed`}
                  aria-label={`${cols}-column feed`}
                >
                  {cols}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Feed Posts List with Sharp Square Images */}
        <div className={`mt-3 ${feedCols === '1' ? 'space-y-4' : 'grid grid-cols-1 sm:grid-cols-2 gap-4' + (feedCols === '3' ? ' lg:grid-cols-3' : feedCols === '4' ? ' lg:grid-cols-3 xl:grid-cols-4' : feedCols === '5' ? ' lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : '')}`}>
          {displayPosts.map((post, idx) => {
            const isLiked = !!likedPosts[post.id];
            const isSaved = !!savedPosts[post.id];
            const currentLikes = likeCounts[post.id] ?? post.like_count ?? 0;
            const postComments = commentsMap[post.id] || [];
            const authorHasStory = storyOwners.has(post.author_id);
           const isObjectMedia = post.url.includes('/api/objects/') || !post.url;
           const isVideo = isMediaVideo(post.mime_type || post.url);
           const isNewPost = animatedPostIds.has(post.id);
           const multiMedia = Array.isArray(post.media) && post.media.length > 1 ? post.media : null;
           const currentIdx = multiMedia ? Math.min(Math.max(0, mediaIdx[post.id] || 0), multiMedia.length - 1) : 0;

            return post.is_sponsored ? (
              <article
                key={post.id}
                className={`bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col [content-visibility:auto] [contain-intrinsic-size:0_560px] shadow-xs ${isNewPost ? 'animate-orbit-feed-in' : ''}`}
              >
                {/* Sponsored Banner */}
                <div className="bg-zinc-950 px-4 py-2 flex items-center gap-2 text-xs text-zinc-400 border-b border-zinc-800">
                  <Sparkles className="w-3.5 h-3.5 text-zinc-300" />
                  <span>Sponsored</span>
                  <span className="ml-auto text-zinc-500">
                    {GAME_AD_TEMPLATES.find((t) => t.mode === post.game_mode)?.gameName || 'gMatch Arcade'}
                  </span>
                </div>

                {/* Ad Visual */}
                <div
                  className={`relative w-full aspect-[4/5] max-h-[65vh] bg-gradient-to-br ${GAME_AD_TEMPLATES.find((t) => t.mode === post.game_mode)?.gradient || 'from-zinc-800 to-zinc-900'} flex flex-col items-center justify-center text-white overflow-hidden`}
                >
                  {(() => {
                    const AdIcon = (post.game_mode && AD_ICON_MAP[post.game_mode]) || Gamepad2;
                    return (
                      <>
                        <AdIcon className="w-16 h-16 opacity-30 absolute -bottom-4 -right-4 pointer-events-none" />
                        <div className="text-center p-6 space-y-3 z-10">
                          <h3 className="text-xl font-black tracking-tight">{post.caption}</h3>
                          {post.players_playing && (
                            <p className="text-xs text-white/80 font-mono">
                              ⚡ {post.players_playing.toLocaleString()} players online now
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              playPress(850);
                              // Single router prop for game ads (restored after
                              // the vercel-style refactor dropped these handlers).
                              onOpenGameAd?.(post.game_mode || 'duel');
                            }}
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-zinc-950 font-bold text-xs uppercase tracking-wider hover:bg-zinc-100 transition-transform active:scale-95 shadow-lg"
                          >
                            <span>{post.cta_label || 'Play Now'}</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </article>
            ) : (
              <article
                key={post.id}
                className={`bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col [content-visibility:auto] [contain-intrinsic-size:0_560px] shadow-xs ${isNewPost ? 'animate-orbit-feed-in' : ''}`}
              >
                {/* Repost Header Banner */}
                {post.is_reposted && (
                  <div className="bg-zinc-950 border-b border-zinc-800 px-4 py-2 flex items-center gap-1.5 text-xs text-zinc-400">
                    <Repeat className="w-3.5 h-3.5 text-zinc-300" />
                    <span>Reposted by <strong className="text-zinc-200 font-medium">@{post.reposted_by || 'Peer'}</strong></span>
                  </div>
                )}

                {/* Post Header */}
                <div className="flex items-center justify-between px-3 sm:px-4 py-3">
                  <div
                    className="flex items-center gap-2.5 cursor-pointer group"
                    onClick={() => handleAvatarClick(post.author_id)}
                    onContextMenu={(e) => onUserContext?.(e, post.author_id, post.author_name)}
                    title={authorHasStory ? 'Watch story' : 'View profile'}
                  >
                    <div className={`w-8 h-8 rounded-full p-[1.5px] flex-shrink-0 ${authorHasStory ? 'bg-gradient-to-tr from-zinc-300 to-zinc-600' : 'bg-zinc-800 border border-zinc-700'}`}>
                      <div className="w-full h-full rounded-full bg-zinc-900 overflow-hidden flex items-center justify-center text-xs font-semibold text-zinc-200">
                        {profilePics[post.author_id] || post.author_avatar ? (
                          <img src={profilePics[post.author_id] || post.author_avatar!} alt="" className="w-full h-full object-cover" />
                        ) : (
                          post.author_name.charAt(0).toUpperCase()
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-zinc-200 group-hover:underline">{post.author_name}</span>
                        <time className="text-[11px] text-zinc-500" dateTime={post.created_at}>
                          {new Date(post.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </time>
                      </div>
                      {post.location && (
                        <span className="text-[11px] text-zinc-500 block">{post.location}</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setOptionsPost(post)}
                    className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-md cursor-pointer hover:bg-zinc-800 transition-colors"
                    aria-label="Post options"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>

                {/* Post Media with Click to Lightbox & Double Tap Like */}
                <div
                  className="relative w-full aspect-[4/5] max-h-[65vh] bg-surface-canvas flex items-center justify-center overflow-hidden cursor-pointer rounded-none"
                  onClick={() => {
                    playPress(700);
                    setActiveLightboxPost(post);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleDoubleTap(post);
                  }}
                >
                  {multiMedia ? (() => {
                    const item = multiMedia[currentIdx];
                    const url = item.url;
                    const mime = item.mime_type;
                    const isObj = url.includes('/api/objects/') || !url;
                    const isVid = isMediaVideo(mime || url);
                    return (
                      <>
                        {isObj ? (
                          <ObjectImage
                            objectId={item.id}
                            contentUrl={url}
                            identity={identity}
                            className="w-full h-full object-cover rounded-none"
                            videoClassName="w-full h-full object-cover rounded-none"
                          />
                        ) : isVid ? (
                          <LazyVideo
                            src={url}
                            videoClassName="w-full h-full object-cover rounded-none"
                            controls
                            muted={false}
                            playOnHover={false}
                            preload="metadata"
                          />
                        ) : (
                          <img
                            src={url}
                            alt={post.caption || 'Post image'}
                            className="w-full h-full object-cover rounded-none"
                            loading="lazy"
                          />
                        )}
                      </>
                    );
                  })() : isObjectMedia ? (
                    <ObjectImage
                      objectId={post.id}
                      contentUrl={post.url}
                      identity={identity}
                      className="w-full h-full object-cover rounded-none"
                      videoClassName="w-full h-full object-cover rounded-none"
                    />
) : isVideo ? (
                      <LazyVideo
                        src={post.url}
                        videoClassName="w-full h-full object-cover rounded-none"
                        controls
                        muted={false}
                        playOnHover={false}
                        preload="metadata"
                      />
                  ) : (
                    <img
                      src={post.url}
                      alt={post.caption || 'Post image'}
                      className="w-full h-full object-cover rounded-none"
                      loading="lazy"
                    />
                  )}

                  {/* Carousel controls + counter for multi-image posts */}
                  {multiMedia && multiMedia.length > 1 && (
                    <>
                      <button
                        type="button"
                        aria-label="Previous image"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMediaIdx((prev) => ({ ...prev, [post.id]: (currentIdx - 1 + multiMedia.length) % multiMedia.length }));
                        }}
                        className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/45 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Next image"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMediaIdx((prev) => ({ ...prev, [post.id]: (currentIdx + 1) % multiMedia.length }));
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/45 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-colors cursor-pointer"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <div className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full bg-black/45 backdrop-blur-sm text-[10px] font-semibold text-white">
                        {currentIdx + 1}/{multiMedia.length}
                      </div>
                    </>
                  )}

                  {/* Double Tap Heart Pop Animation */}
                  {doubleTapAnimationId === post.id && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 animate-orbit-pop">
                      <Heart className="w-20 h-20 text-white fill-white opacity-90" />
                    </div>
                  )}
                </div>

                {/* Action Bar (Like, Comment, Share, Save) */}
                <div className="px-3 sm:px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => toggleLike(post)}
                        aria-label="Like post"
                        className="cursor-pointer transition-transform duration-150 active:scale-[0.92]"
                      >
                        <Heart
                          className={`w-4 h-4 transition-colors stroke-[1.75] ${isLiked ? 'text-rose-500 fill-rose-500' : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          playPress(750);
                          setActiveLightboxPost(post);
                        }}
                        aria-label="Comment"
                        className="text-zinc-400 hover:text-zinc-200 cursor-pointer transition-transform duration-150 active:scale-[0.92]"
                      >
                        <MessageCircle className="w-4 h-4 stroke-[1.75]" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setSharingPost(post)}
                        aria-label="Share post"
                        className="text-zinc-400 hover:text-zinc-200 cursor-pointer transition-transform duration-150 active:scale-[0.92]"
                      >
                        <Send className="w-4 h-4 stroke-[1.75]" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleSave(post)}
                      aria-label="Save post"
                      className="cursor-pointer transition-transform duration-150 active:scale-[0.92]"
                    >
                      <Bookmark
                        className={`w-4 h-4 transition-colors stroke-[1.75] ${isSaved ? 'text-zinc-100 fill-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                      />
                    </button>
                  </div>

                  {/* Likes Count */}
                  {currentLikes > 0 && (
                    <div className="text-xs font-semibold text-zinc-300 font-mono tracking-tight">
                      {currentLikes.toLocaleString()} {currentLikes === 1 ? 'like' : 'likes'}
                    </div>
                  )}

                  {/* Caption & Tags */}
                  {post.caption && (
                    <div className="text-xs text-zinc-300 leading-relaxed">
                      <span
                        className="font-semibold text-zinc-100 mr-1.5 cursor-pointer hover:underline"
                        onClick={() => onSelectUser?.(post.author_id)}
                      >
                        {post.author_name}
                      </span>
                      <span>{post.caption}</span>
                    </div>
                  )}

                  {/* Tag Badges */}
                  {post.tags && post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {post.tags.map((t) => (
                        <span
                          key={t}
                          onClick={() => boostTagAffinity([t])}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800/70 text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
                        >
                          #{t.replace(/^#/, '')}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Comments Trigger & Recent Preview */}
                  {postComments.length > 0 ? (
                    <div className="space-y-1 mt-0.5">
                      <button
                        type="button"
                        onClick={() => { playPress(750); setActiveLightboxPost(post); }}
                        className="text-left text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer font-medium block"
                      >
                        View all {postComments.length} comments
                      </button>

                      {/* Show top recent comment snippet */}
                      <div className="text-xs text-zinc-300 flex items-center justify-between">
                        <div className="truncate">
                          <strong className="font-semibold text-zinc-100 mr-1.5">{postComments[postComments.length - 1].author_name}</strong>
                          <span className="text-zinc-400">{postComments[postComments.length - 1].text}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { playPress(750); setActiveLightboxPost(post); }}
                      className="text-left text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    >
                      Add a comment...
                    </button>
                  )}
                </div>
              </article>
            );
          })}

          {displayPosts.length === 0 && (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-8 text-center space-y-3 shadow-xs my-4">
              <div className="w-12 h-12 rounded-full bg-zinc-800/60 border border-zinc-700/60 flex items-center justify-center mx-auto text-zinc-400">
                <Camera className="w-5 h-5 stroke-[1.75]" />
              </div>
              <h4 className="text-sm font-semibold text-zinc-100">No Posts Yet</h4>
              <p className="text-xs text-zinc-400 max-w-xs mx-auto leading-relaxed">
                Capture or upload your first photo or video post to start sharing with your friends!
              </p>
              <button
                type="button"
                onClick={() => {
                  if (onOpenPostCreator) onOpenPostCreator();
                  else setShowCustomPostCreator(true);
                }}
                 className="create-action px-4 py-2 text-xs font-semibold rounded-md transition-all duration-150 active:scale-[0.96] shadow-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <PlusSquare className="w-4 h-4 stroke-[2]" />
                 <span>Drop your first moment</span>
              </button>
            </div>
          )}

          {/* Infinite Scroll Sentinel & Loading Spinner */}
          {displayPosts.length > 0 && hasMore !== false && (
            <div ref={sentinelRef} className="py-6 flex flex-col items-center justify-center gap-2">
              {(internalLoadingMore || isLoadingMore) ? (
                <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800 shadow-xs text-xs font-medium text-zinc-300">
                  <span className="w-3.5 h-3.5 border-2 border-zinc-700 border-t-zinc-200 rounded-full animate-spin" />
                  <span>Loading more moments…</span>
                </div>
              ) : (
                <div className="h-6 w-full" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── MODAL 1: Share Post to DMs or Groups (portaled: immune to ancestor filters) ─── */}
      {sharingPost && createPortal(
        <SharePostModal
          post={sharingPost}
          onClose={() => setSharingPost(null)}
          followingIds={followingIds}
          profilePics={profilePics}
          userNames={Object.fromEntries(users.map((u) => [u.id, u.display_name || '']))}
          identity={identity}
          toast={toast}
        />,
        document.body,
      )}

      {/* ─── MODAL 2: Comments Slide-Up Sheet (portaled) ─── */}
      {activeCommentsPost && createPortal(
<CommentsModal
            post={activeCommentsPost}
            onClose={() => setActiveCommentsPostId(null)}
            comments={commentsMap[activeCommentsPost.id] || []}
            profilePics={profilePics}
            onAddComment={handleAddComment}
            onToggleCommentLike={handleToggleCommentLike}
            onAvatarClick={handleAvatarClick}
            onReportComment={onReportComment}
            toast={toast}
          />,
        document.body,
      )}

      {/* ─── MODAL 3: Post Options Action Sheet (portaled) ─── */}
      {optionsPost && createPortal(
        <PostOptionsModal
          post={optionsPost}
          onClose={() => setOptionsPost(null)}
          identityOrbitId={identity?.orbitId}
          onRepost={onRepostPost}
          onShare={(p) => setSharingPost(p)}
          onCopyLink={handleCopyLink}
          onArchive={onArchivePost}
          onDelete={(id) => { onDeletePostApi?.(id); onDeletePost?.(id); }}
          onReport={(p) => setReportingPost(p)}
          toast={toast}
        />,
        document.body,
      )}

      {/* ─── MODAL 4: Report Post Category Selection (portaled) ─── */}
      {reportingPost && createPortal(
        <ReportPostModal
          post={reportingPost}
          onClose={() => setReportingPost(null)}
          onReport={onPersistReport}
          toast={toast}
        />,
        document.body,
      )}

      {/* ─── MODAL 5: 2-Column Instagram Lightbox Post Modal with Zoom & Real Comments ─── */}
      <InstagramPostModal
        isOpen={!!activeLightboxPost}
        post={activeLightboxPost}
        onClose={() => setActiveLightboxPost(null)}
        identity={identity}
        profilePics={profilePics}
        isLiked={activeLightboxPost ? !!likedPosts[activeLightboxPost.id] : false}
        isSaved={activeLightboxPost ? !!savedPosts[activeLightboxPost.id] : false}
        likeCount={activeLightboxPost ? likeCounts[activeLightboxPost.id] ?? activeLightboxPost.like_count ?? 0 : 0}
        comments={activeLightboxPost ? commentsMap[activeLightboxPost.id] || [] : []}
        onToggleLike={toggleLike}
        onToggleSave={toggleSave}
        onAddComment={handleAddComment}
        onToggleCommentLike={handleToggleCommentLike}
        onOpenShare={(p) => {
          setActiveLightboxPost(null);
          setSharingPost(p);
        }}
        onOptionsClick={(p) => {
          setActiveLightboxPost(null);
          setOptionsPost(p);
        }}
        onSelectUser={onSelectUser}
        onAvatarClick={(uId) => {
          setActiveLightboxPost(null);
          handleAvatarClick(uId);
        }}
        onOpenNetwork={(uId) => {
          setActiveLightboxPost(null);
          onOpenNetwork?.(uId);
        }}
        toast={toast}
      />

      {/* ─── MODAL 6: Live Camera Snapshot Modal (portaled) ─── */}
      {createPortal(
      <LiveCameraModal
        isOpen={showCameraModal}
        onClose={() => setShowCameraModal(false)}
        onCapture={async (dataUrl) => {
          const res = await cropCameraShot(dataUrl, { aspect: '4:5', title: 'Crop post image' });
          if (!res) return;
          setPostCreatorMedia((prev) => (prev.length < 5 ? [...prev, res.dataUrl] : prev));
          setShowCustomPostCreator(true);
        }}
        toast={toast}
      />,
      document.body,
      )}

      {/* ─── MODAL 6b: Explore / Search (portaled) ─── */}
      {createPortal(
      <ExploreSearchModal
        isOpen={showExploreSearch}
        onClose={() => setShowExploreSearch(false)}
        identity={identity}
        users={users}
        posts={posts}
        profilePics={profilePics}
        onSelectUser={(userId) => {
          setShowExploreSearch(false);
          onSelectUser?.(userId);
        }}
        onOpenPost={(post) => {
          setShowExploreSearch(false);
          setActiveLightboxPost(post);
        }}
        onStartPm={onStartPm}
        toast={toast}
      />,
      document.body,
      )}

      {/* ─── MODAL 7: Multi-Media Post Creator with Mandatory Tags (portaled) ─── */}
      {createPortal(
      <PostCreatorModal
        isOpen={showCustomPostCreator}
        onClose={() => setShowCustomPostCreator(false)}
        media={postCreatorMedia}
        setMedia={setPostCreatorMedia}
        caption={postCreatorCaption}
        setCaption={setPostCreatorCaption}
        tags={postCreatorTags}
        setTags={setPostCreatorTags}
        onOpenCamera={() => setShowCameraModal(true)}
        onPublish={onPublishPost}
        toast={toast}
      />,
      document.body,
      )}
      {cameraCropper && createPortal(cameraCropper, document.body)}
    </div>
  );
}
