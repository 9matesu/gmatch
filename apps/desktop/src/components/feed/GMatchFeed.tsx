"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCropper } from '../../hooks/useCropper';
import { DEFAULT_FEED_SORT, FEED_SORT_LABELS, firstLikeCrossed, type FeedSort } from './feedSort'
import { suggestFollows } from './suggestFollows'
import { playPress, playWin, playMsgReceive, playLikeOnce } from '../../utils/sounds';
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
  Sparkles,
  Repeat,
  PlusSquare,
  Coffee,
  Swords,
  Trophy,
  ShoppingBag,
  Flame,
  Gamepad2,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject as StoryItem } from '@orbit/shared';
import { GMatchStories } from '../GMatchStories';
import { InstagramPostModal } from './InstagramPostModal';
import { LiveCameraModal } from '../camera/LiveCameraModal';
import { ObjectImage } from '../ObjectImage';
import CachedImg from '../../ui/CachedImg';
import { LazyVideo } from '../LazyVideo';
import { NativeVideoPlayer } from '../media/NativeVideoPlayer';
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
import { PostLikersModal } from './PostLikersModal';
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

export function GMatchFeed({
  identity,
  posts,
  stories,
  storiesLoading = false,
  followingIds = [],
  profilePics = {},
  onSendDm,
  users = [],
  onAddStory,
  onOpenStory,
  activeStoryUserId = null,
  onActiveStoryClose,
  onOpenPostCreator,  onFollowSuggestion,
  myProfileTags = [],
  onSelectUser,
  onOpenGameAd,
  shareGroups = [],
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
  feedSort = DEFAULT_FEED_SORT,
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
  /** Courier-aware DM transport owned by App (server inbox or sealed courier). */
  onSendDm?: (peerId: string, text: string) => Promise<boolean>;
  users?: Array<{ id: string; display_name?: string; orbitId?: string; pfp_url?: string | null; tags?: string[]; online?: boolean; followers_count?: number }>;
  onAddStory?: () => void;
  onOpenStory?: (userId: string) => void;
  activeStoryUserId?: string | null;
  onActiveStoryClose?: () => void;
  onOpenPostCreator?: () => void;
  onFollowSuggestion?: (userId: string) => void | Promise<void>;
  myProfileTags?: string[];
  onSelectUser?: (userId: string) => void;
  onOpenGameAd?: (mode: 'duel' | 'babecock' | 'ranks' | 'store' | 'discord' | 'coffee') => void;
  /** Real groups for the share sheet. */
  shareGroups?: { id: string; name: string; member_count: number }[];
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
  feedSort?: FeedSort;
  onFeedSortChange?: (sort: FeedSort) => void;
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
  const [likersModalPostId, setLikersModalPostId] = useState<string | null>(null);
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

  const followSuggestions = useMemo(
    () => displayPosts.length === 0
      ? suggestFollows(users ?? [], identity?.orbitId, myProfileTags, new Set(followingIds))
      : [],
    [displayPosts.length, users, identity?.orbitId, myProfileTags, followingIds],
  );

  // First-like flash: session-local celebration when MY post crosses 0 -> 1
  // likes after mount. Pre-liked posts at mount are seeded into the baseline
  // ref so reloads don't re-celebrate old news.
  const firstLikedBaseline = useRef<Set<string> | null>(null)
  const [firstLikeId, setFirstLikeId] = useState<string | null>(null)
  useEffect(() => {
    if (!identity?.orbitId) return
    if (firstLikedBaseline.current === null) {
      firstLikedBaseline.current = new Set(
        posts.filter((p) => p.author_id === identity.orbitId && (p.like_count ?? 0) > 0).map((p) => p.id),
      )
      return
    }
    for (const p of posts) {
      if (p.author_id !== identity.orbitId) continue
      const prev = p.like_count ?? 0
      const next = likeCounts[p.id] ?? prev
      if (firstLikeCrossed(prev, next) && !firstLikedBaseline.current.has(p.id)) {
        firstLikedBaseline.current.add(p.id)
        playLikeOnce()
        setFirstLikeId(p.id)
        const timer = setTimeout(() => setFirstLikeId(null), 1500)
        return () => clearTimeout(timer)
      }
    }
  }, [posts, likeCounts, identity?.orbitId])

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

      {/* Feed Top Header — the only bar: brand, sort tabs, search, alerts */}
      <FeedHeader
        unreadCount={unreadCount}
        onOpenSearch={() => setShowExploreSearch(true)}
        onOpenNotifications={() => {
          if (onOpenNotifications) onOpenNotifications();
          onRefreshNotifications?.();
        }}
        sortTabs={
          <div className="flex items-center gap-1 text-xs">
            {(['latest', 'trending'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => { playPress(720); onFeedSortChange?.(mode); }}
                className={`px-3 py-1.5 rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer font-medium ${feedSort === mode
                    ? 'bg-glass-w12 text-retro-fg shadow-xs border border-border-glass'
                    : 'text-retro-muted hover:text-retro-fg'
                  }`}
              >
                {FEED_SORT_LABELS[mode]}
              </button>
            ))}
          </div>
        }
      />

      {/* Feed Content Column (Posts) */}
      <div className="w-full max-w-[1400px] mx-auto flex flex-col px-2 sm:px-4 py-2 space-y-3">
        {/* Density bar: post count + column picker */}
        <div className="flex items-center justify-end px-3 sm:px-6 py-1 gap-2 border-b border-border-glass">
          <div className="flex items-center gap-3">
            <span className="text-xs text-retro-muted">
              {displayPosts.length} posts
            </span>
            <div className="flex items-center bg-retro-panel border border-border-glass rounded-md p-0.5 text-xs">
              {(['1', '2', '3', '4', '5'] as const).map((cols) => (
                <button
                  key={cols}
                  type="button"
                  onClick={() => { playPress(720); onFeedColsChange?.(cols); }}
                  className={`px-2 py-1 rounded transition-all duration-150 active:scale-[0.96] cursor-pointer font-medium ${feedCols === cols
                      ? 'bg-retro-accent text-retro-accent-text font-semibold'
                      : 'text-retro-muted hover:text-retro-fg'
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
        <div className={`mt-3 ${feedCols === '1' ? 'space-y-3' : 'grid grid-cols-1 sm:grid-cols-2 gap-3' + (feedCols === '3' ? ' lg:grid-cols-3' : feedCols === '4' ? ' lg:grid-cols-3 xl:grid-cols-4' : feedCols === '5' ? ' lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : '')}`}>
          {displayPosts.map((post, _idx) => {
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
                className={`bg-retro-panel border border-border-glass rounded-lg overflow-hidden flex flex-col [content-visibility:auto] [contain-intrinsic-size:0_560px] shadow-xs ${isNewPost ? 'animate-orbit-feed-in' : ''}`}
              >
                {/* Sponsored Banner */}
                <div className="bg-retro-bg px-4 py-2 flex items-center gap-2 text-xs text-retro-muted border-b border-border-glass">
                  <Sparkles className="w-3.5 h-3.5 text-retro-fg" />
                  <span>Sponsored</span>
                  <span className="ml-auto text-retro-muted">
                    {GAME_AD_TEMPLATES.find((t) => t.mode === post.game_mode)?.gameName || 'gMatch Arcade'}
                  </span>
                </div>

                {/* Ad Visual */}
                <div
                  className={`relative w-full aspect-[4/5] max-h-[min(420px,60vh)] bg-gradient-to-br ${GAME_AD_TEMPLATES.find((t) => t.mode === post.game_mode)?.gradient || 'from-zinc-800 to-zinc-900'} flex flex-col items-center justify-center text-white overflow-hidden`}
                >
                  {(() => {
                    const AdIcon = (post.game_mode && AD_ICON_MAP[post.game_mode]) || Gamepad2;
                    return (
                      <>
                        <AdIcon className="w-16 h-16 opacity-30 absolute -bottom-4 -right-4 pointer-events-none" />
                        <div className="text-center p-6 space-y-3 z-10">
                          <h3 className="text-xl font-black tracking-tight">{post.caption}</h3>
                          {post.players_playing && (
                            <p className="text-xs text-retro-body font-mono">
                              <Zap className="inline w-3 h-3" /> {post.players_playing.toLocaleString()} online
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
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-retro-accent text-retro-accent-text font-bold text-xs uppercase tracking-wider hover:bg-retro-accent-hover transition-colors active:scale-[0.98] shadow-lg"
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
                onContextMenu={(e) => { e.preventDefault(); setOptionsPost(post) }}
                className={`bg-retro-panel border border-border-glass rounded-lg overflow-hidden flex flex-col [content-visibility:auto] [contain-intrinsic-size:0_560px] shadow-xs ${isNewPost ? 'animate-orbit-feed-in' : ''}`}
              >
                {/* Repost Header Banner */}
                {post.is_reposted && (
                  <div className="bg-retro-bg border-b border-border-glass px-4 py-2 flex items-center gap-1.5 text-xs text-retro-muted">
                    <Repeat className="w-3.5 h-3.5 text-retro-fg" />
                    <span>Reposted by <strong className="text-retro-fg font-medium">@{post.reposted_by || 'Peer'}</strong></span>
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
                    <div className={`w-8 h-8 rounded-full p-[1.5px] flex-shrink-0 ${authorHasStory ? 'bg-gradient-to-tr from-zinc-300 to-zinc-600' : 'bg-glass-w12 border border-border-glass'}`}>
                      <div className="w-full h-full rounded-full bg-retro-panel overflow-hidden flex items-center justify-center text-xs font-semibold text-retro-fg">
                        {profilePics[post.author_id] || post.author_avatar ? (
                          <img src={resolveMediaUrl(profilePics[post.author_id] || post.author_avatar!)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          post.author_name.charAt(0).toUpperCase()
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-retro-fg group-hover:underline">{post.author_name}</span>
                        <time className="text-xs text-retro-muted" dateTime={post.created_at}>
                          {new Date(post.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </time>
                      </div>
                      {post.location && (
                        <span className="text-xs text-retro-muted block">{post.location}</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setOptionsPost(post)}
                    className="text-retro-muted hover:text-retro-fg p-1.5 rounded-md cursor-pointer hover:bg-glass-w12 transition-colors"
                    aria-label="Post options"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>

                {/* Post Media with Click to Lightbox & Double Tap Like */}
                {(() => {
                  const activeItem = multiMedia ? multiMedia[currentIdx] : null;
                  const activeUrl = activeItem ? activeItem.url : post.url;
                  const activeMime = activeItem ? activeItem.mime_type : post.mime_type;
                  const isCurrentVideo = isMediaVideo(activeMime || activeUrl);

                  return (
                    <div
                      className={`relative w-full bg-surface-canvas flex items-center justify-center overflow-hidden rounded-none ${isCurrentVideo ? '' : 'cursor-pointer'}`}
                      onClick={() => {
                        if (!isCurrentVideo) {
                          playPress(700);
                          setActiveLightboxPost(post);
                        }
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
                                mimeType={mime}
                                className="w-full h-auto max-h-[min(680px,80vh)] object-contain rounded-none"
                                videoClassName="w-full max-h-[min(680px,80vh)] object-contain rounded-none"
                                controls={true}
                                alwaysShowControls={true}
                                autoPlay={true}
                                muted={true}
                                loop={true}
                                onExpand={() => setActiveLightboxPost(post)}
                                onDoubleTapLike={() => handleDoubleTap(post)}
                              />
                            ) : isVid ? (
                              <NativeVideoPlayer
                                src={url}
                                videoClassName="w-full max-h-[min(680px,80vh)] object-contain rounded-none"
                                controls={true}
                                alwaysShowControls={true}
                                autoPlay={true}
                                muted={true}
                                loop={true}
                                onExpand={() => setActiveLightboxPost(post)}
                                onDoubleTapLike={() => handleDoubleTap(post)}
                              />
                            ) : (
                              <CachedImg
                                src={url}
                                alt={post.caption || 'Post image'}
                                className="w-full h-auto max-h-[min(680px,80vh)] object-contain rounded-none"
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
                          mimeType={post.mime_type}
                          className="w-full h-auto max-h-[min(680px,80vh)] object-contain rounded-none"
                          videoClassName="w-full max-h-[min(680px,80vh)] object-contain rounded-none"
                          controls={true}
                          alwaysShowControls={true}
                          autoPlay={true}
                          muted={true}
                          loop={true}
                          onExpand={() => setActiveLightboxPost(post)}
                          onDoubleTapLike={() => handleDoubleTap(post)}
                        />
                      ) : isVideo ? (
                        <NativeVideoPlayer
                          src={post.url}
                          videoClassName="w-full max-h-[min(680px,80vh)] object-contain rounded-none"
                          controls={true}
                          alwaysShowControls={true}
                          autoPlay={true}
                          muted={true}
                          loop={true}
                          onExpand={() => setActiveLightboxPost(post)}
                          onDoubleTapLike={() => handleDoubleTap(post)}
                        />
                      ) : (
                        <CachedImg
                          src={post.url}
                          alt={post.caption || 'Post image'}
                          className="w-full h-auto max-h-[min(680px,80vh)] object-contain rounded-none"
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
                          <div className="absolute top-2.5 right-2.5 z-10 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-xs text-[10px] font-medium text-white/90">
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
                      {firstLikeId === post.id && (
                        <span className="absolute left-2 top-2 z-20 text-[10px] font-bold text-retro-fg bg-retro-panel border border-border-glass rounded-md px-1.5 py-0.5 animate-orbit-pop">
                          First like
                        </span>
                      )}
                    </div>
                  );
                })()}

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
                          className={`w-4 h-4 transition-colors stroke-[1.75] ${isLiked ? 'text-rose-500 fill-rose-500' : 'text-retro-muted hover:text-retro-fg'
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
                        className="text-retro-muted hover:text-retro-fg cursor-pointer transition-transform duration-150 active:scale-[0.92]"
                      >
                        <MessageCircle className="w-4 h-4 stroke-[1.75]" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setSharingPost(post)}
                        aria-label="Share post"
                        className="text-retro-muted hover:text-retro-fg cursor-pointer transition-transform duration-150 active:scale-[0.92]"
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
                        className={`w-4 h-4 transition-colors stroke-[1.75] ${isSaved ? 'text-retro-fg fill-retro-fg' : 'text-retro-muted hover:text-retro-fg'
                          }`}
                      />
                    </button>
                  </div>

                  {/* Likes Count */}
                  <button
                    type="button"
                    onClick={() => {
                      playPress(700);
                      setLikersModalPostId(post.id);
                    }}
                    className="text-left text-xs font-semibold text-retro-fg tracking-tight hover:underline cursor-pointer w-fit transition-colors"
                    aria-label="View who liked this post"
                  >
                    {currentLikes.toLocaleString()} {currentLikes === 1 ? 'like' : 'likes'}
                  </button>

                  {/* Caption & Tags */}
                  {post.caption && (
                    <div className="text-xs text-retro-fg leading-relaxed">
                      <span
                        className="font-semibold text-retro-fg mr-1.5 cursor-pointer hover:underline"
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
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-glass-w12 text-retro-muted hover:text-retro-fg cursor-pointer transition-colors"
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
                        className="text-left text-xs text-retro-muted hover:text-retro-fg cursor-pointer font-medium block"
                      >
                        View all {postComments.length} comments
                      </button>

                      {/* Show top recent comment snippet */}
                      <div className="text-xs text-retro-fg flex items-center justify-between">
                        <div className="truncate">
                          <strong className="font-semibold text-retro-fg mr-1.5">{postComments[postComments.length - 1].author_name}</strong>
                          <span className="text-retro-muted">{postComments[postComments.length - 1].text}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { playPress(750); setActiveLightboxPost(post); }}
                      className="text-left text-xs text-retro-muted hover:text-retro-fg cursor-pointer"
                    >
                      Add a comment...
                    </button>
                  )}
                </div>
              </article>
            );
          })}

          {displayPosts.length === 0 && (
            <div className="bg-retro-panel border border-border-glass rounded-lg p-8 text-center space-y-4 shadow-xs my-4 max-w-md mx-auto">
              <div>
                <h4 className="text-sm font-semibold text-retro-fg">Empty in here? Start posting and get things moving.</h4>
                <p className="text-xs text-retro-muted mt-1 leading-relaxed">
                  One upload, three tags. Posts are what grow followers.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (onOpenPostCreator) onOpenPostCreator();
                  else setShowCustomPostCreator(true);
                }}
                className="create-action px-4 py-2 text-xs font-semibold rounded-md transition-all duration-150 active:scale-[0.96] shadow-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <PlusSquare className="w-4 h-4 stroke-[2]" />
                <span>Upload your first post</span>
              </button>
              {followSuggestions.length > 0 && (
                <div className="pt-2 border-t border-border-glass">
                  <p className="text-[10px] uppercase tracking-wider text-retro-muted mb-2">Or follow someone</p>
                  <div className="flex items-center justify-center gap-3">
                    {followSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { void onFollowSuggestion?.(s.id); }}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                        aria-label={`Follow ${s.display_name || s.id}`}
                      >
                        <span className="w-10 h-10 rounded-full overflow-hidden border border-border-glass flex items-center justify-center text-xs text-retro-fg bg-glass-w5">
                          {profilePics?.[s.id] ? (
                            <img src={resolveMediaUrl(profilePics[s.id])} alt="" className="w-full h-full object-cover" />
                          ) : (
                            (s.display_name || s.id).slice(0, 2).toUpperCase()
                          )}
                        </span>
                        <span className="text-[10px] text-retro-muted truncate max-w-[72px] group-hover:text-retro-fg">{s.display_name}</span>
                        <span className="text-[10px] text-retro-fg border border-border-glass rounded-md px-1.5 py-0.5 group-hover:bg-glass-w10">Follow</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Infinite Scroll Sentinel & Loading Spinner */}
          {displayPosts.length > 0 && hasMore !== false && (
            <div ref={sentinelRef} className="py-6 flex flex-col items-center justify-center gap-2">
              {(internalLoadingMore || isLoadingMore) ? (
                <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-retro-panel border border-border-glass shadow-xs text-xs font-medium text-retro-fg">
                  <span className="w-3.5 h-3.5 border-2 border-border-glass border-t-retro-fg rounded-full animate-spin" />
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
          groups={shareGroups}
          onSendDm={onSendDm}
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
        onOpenLikers={(postId) => setLikersModalPostId(postId)}
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

      {/* ─── MODAL 5b: Likers Modal ─── */}
      {likersModalPostId && (
        <PostLikersModal
          postId={likersModalPostId}
          isOpen={!!likersModalPostId}
          onClose={() => setLikersModalPostId(null)}
          identity={identity}
          profilePics={profilePics}
          onSelectUser={(userId) => {
            setLikersModalPostId(null);
            setActiveLightboxPost(null);
            handleAvatarClick(userId);
          }}
          toast={toast}
        />
      )}

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
