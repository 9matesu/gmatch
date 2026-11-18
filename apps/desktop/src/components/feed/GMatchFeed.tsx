"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { useCropper } from '../../hooks/useCropper';
import { DEFAULT_FEED_SORT, FEED_SORT_LABELS, firstLikeCrossed, type FeedSort } from './feedSort'
import { formatLikedBy } from '../../utils/likedBy'
import { createLikeGovernor, type LikeGovernor } from '../../utils/likeReconcile'
import { suggestFollows } from './suggestFollows'
import { playPress, playWin, playMsgReceive, playLikeOnce } from '../../utils/sounds';
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  FolderPlus,
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
  ChevronUp,
  ZoomIn,
  ZoomOut,
  Zap,
  RefreshCw,
  Loader2,
  Rows3,
  LayoutGrid,
} from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject as StoryItem } from '@orbit/shared';
import { generateFallbackName } from '@orbit/shared';
import { countHidden, isRenderable } from './isRenderable';
import { hasInlineMedia } from './mediaReadiness';
import { FeedGrid } from './FeedGrid';
import { GMatchStories } from '../GMatchStories';
import { PostComments } from './PostComments';
import { SideSheet } from '../../ui/kit';
import { LiveCameraModal } from '../camera/LiveCameraModal';
import { ObjectImage } from '../ObjectImage';
import { Avatar } from '../Avatar';
import CachedImg from '../../ui/CachedImg';
import { NativeVideoPlayer } from '../media/NativeVideoPlayer';
import { isVideoPost, resolveMediaUrl } from '../../utils/media';
import { vaultPin, vaultBridge } from '../../services/vault';

/** Sibling item MIME types for render-time video detection (see isVideoPost). */
function siblingMimesFor(post: FeedPost): string[] {
  return Array.isArray(post.media) ? post.media.map((m) => m.mime_type) : [];
}
import { orbitFetch, postShareUrl } from '../../utils/api';
import { GAME_AD_TEMPLATES } from '../../utils/gameAds';
import { ExploreSearchModal } from './ExploreSearchModal';
import { useNow } from '../../hooks/useNow';
import { usePeerCommentsByPost } from '../../hooks/usePeerComments';
import { mergeCommentRows } from '../../utils/commentMerge';
import { SharePostModal } from './SharePostModal';
import { PostTimestamp } from './PostTimestamp';
import { PostOptionsModal } from './PostOptionsModal';
import { ReportPostModal } from './ReportPostModal';
import { PostCreatorModal } from './PostCreatorModal';
import { PostLikersModal } from './PostLikersModal';
import { FeedHeader } from './FeedHeader';
import { FeedStatusPills } from './FeedStatusPills';
import { Linkify } from '../Linkify';

export interface PostComment {
  id: string;
  author_id: string;
  author_name: string;
  author_avatar?: string | null;
  text: string;
  created_at: string;
  like_count: number;
  is_liked?: boolean;
  /** Set when this comment is a reply to another comment on the same post. */
  parent_comment_id?: string | null;
  /** Optimistic row not yet confirmed by the server. */
  pending?: boolean;
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
  /** Session-only blob: URL for an own fresh post. Renders instantly without
   *  any fetch; never persisted, replaced by server reconciliation. */
  localPreviewUrl?: string | null;
  caption?: string;
  location?: string;
  tags?: string[];
  created_at: string;
  like_count: number;
  /** Phase 3 durable publish: optimistic own-post sync badge. Absent on
   *  reconciled server rows (nothing to show). */
  sync_state?: 'local' | 'pending' | 'replicated';
  /** Where this row came from: a node's feed route or the local operation log
   *  (peer-replicated). Absent means the legacy server path. */
  origin?: 'server' | 'peer';
  /** Newest-first liker names for the "Liked by X and N others" line. */
  likers?: { user_id: string; display_name: string; pfp_url?: string | null }[];
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

const AD_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  discord: MessageCircle,
  coffee: Coffee,
  duel: Swords,
  babecock: Flame,
  ranks: Trophy,
  store: ShoppingBag,
}

function GMatchFeedImpl({
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
  feedLayout = 'list',
  onFeedLayoutChange,
  toast,
  onUserContext,
  onForceRefresh,
  onPingAttention,
  feedStatus = 'ready',
  onResolveMissingPost,
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
  onPersistComment?: (postId: string, text: string, parentCommentId?: string | null) => Promise<PostComment | null>;
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
  /** Timeline shape: the Twitter-style column or the justified image grid. */
  feedLayout?: 'list' | 'grid';
  onFeedLayoutChange?: (layout: 'list' | 'grid') => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onOpenNetwork?: (userId: string) => void;
  onUserContext?: (e: React.MouseEvent, userId: string, displayName: string) => void;
  /** Retrieve-by-force: drops cached/inflight feed responses, then reloads. */
  onPingAttention?: () => void;
  onForceRefresh?: () => void;
  /** Initial load vs refresh vs blind-courier node vs read error. */
  feedStatus?: 'idle' | 'loading' | 'ready' | 'offline' | 'error';
  /**
   * Ask the owner of the feed for a single post by id when a deep link names
   * one the snapshot does not carry. Resolves true when the post is (or just
   * became) part of `posts`.
   */
  onResolveMissingPost?: (postId: string) => Promise<boolean>;
}) {
  const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({});
  const [savedPosts, setSavedPosts] = useState<Record<string, boolean>>({});
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  // Mutation governor owns no state itself — it only sequences persist calls
  // against the maps above (generation per post, rollback on failure).
  //
  // A counted value that came from the user's own like action is the only kind
  // allowed to outrank the post itself while the write is in flight. The post's
  // count at the moment of the action is remembered so the override can be
  // retired the instant the post moves: the feed can render a tile from a
  // local/P2P mirror BEFORE the server row lands (mirror rows carry no count,
  // so they read 0), and locking the first value ever seen is what made a liked
  // post keep reading "0 likes" until a full remount.
  const likeGov = useRef<LikeGovernor | null>(null);
  const governedLikeCounts = useRef<Map<string, { override: number; postAt: number | undefined }>>(new Map());
  /** The like_count each post carried the last time the list was seeded. */
  const postedLikeCounts = useRef<Map<string, number>>(new Map());
  if (!likeGov.current) {
    likeGov.current = createLikeGovernor({
      setLiked: (id, v) => setLikedPosts((prev) => ({ ...prev, [id]: v })),
      setCount: (id, n) => {
        governedLikeCounts.current.set(id, { override: n, postAt: postedLikeCounts.current.get(id) });
        setLikeCounts((counts) => ({ ...counts, [id]: n }));
      },
    });
  }
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
    if (!sentinelRef.current || typeof IntersectionObserver === 'undefined') return;
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
  // Inline expansion (replaces the feed lightbox): one post at a time, same
  // card element (no remount, reader position preserved). Zoom is a bounded
  // scale cycle on the same media node, reset on every expand/collapse.
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  /** Comment to spotlight after a notification deep link lands on the post. */
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const toggleExpand = useCallback((post: FeedPost) => {
    playPress(700);
    setFocusCommentId(null);
    setExpandedPostId((prev) => (prev === post.id ? null : post.id));
    setZoomLevel(1);
  }, []);
  const openInline = useCallback((post: FeedPost, scroll = false) => {
    playPress(700);
    setExpandedPostId(post.id);
    setZoomLevel(1);
    if (scroll) {
      requestAnimationFrame(() => {
        document.querySelector(`[data-post-id="${post.id}"]`)?.scrollIntoView?.({ block: 'nearest' });
      });
    }
  }, []);
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
  const [commentsMap, setCommentsMap] = useState<Record<string, PostComment[]>>({});
  // Comments that only exist as signed operations (peer-replicated posts).
  const peerComments = usePeerCommentsByPost(identity?.orbitId);
  /** Posts whose comment list is already in `commentsMap` — a ref, not state, so
   *  the fetch effect doesn't re-run (and refetch) on every list mutation. */
  const commentsLoadedRef = useRef<Set<string>>(new Set());
  const [commentsLoadingId, setCommentsLoadingId] = useState<string | null>(null);

  // Share Modal State
  const [sharingPost, setSharingPost] = useState<FeedPost | null>(null);

  // Deep link: #/feed?post=<id> (share/permalink, or a notification target)
  // expands the post inline. The id is remembered so a *different* id can open
  // later, and a hashchange is honoured after the feed already loaded — the
  // hash-only navigation used to be ignored entirely, which is why a permalink
  // only worked when the app happened to reload from scratch.
  const deepLinkDoneRef = useRef<string | null>(null);
  /** Id the current hash names but the list does not carry (yet). */
  const pendingDeepLinkRef = useRef<{ postId: string; commentId: string | null } | null>(null);

  const openFromDeepLink = useCallback((postId: string, commentId: string | null) => {
    const target = posts.find((p) => p.id === postId);
    if (!target) return false;
    deepLinkDoneRef.current = postId;
    pendingDeepLinkRef.current = null;
    // A reply/mention/like notification names the exact comment; the post is
    // only the container. PostComments spotlights it once the list loads.
    setFocusCommentId(commentId);
    openInline(target, true);
    return true;
  }, [posts, openInline]);

  const requestDeepLink = useCallback((postId: string, commentId: string | null) => {
    if (openFromDeepLink(postId, commentId)) return;
    // Not in the snapshot: ask the feed owner for a targeted read, once.
    if (pendingDeepLinkRef.current?.postId === postId) return;
    pendingDeepLinkRef.current = { postId, commentId };
    void onResolveMissingPost?.(postId);
  }, [openFromDeepLink, onResolveMissingPost]);

  const readDeepLinkHash = useCallback(() => {
    if (typeof window === 'undefined') return;
    const postId = /post=([^&#]+)/.exec(window.location.hash)?.[1];
    if (!postId) return;
    const decodedPost = decodeURIComponent(postId);
    if (deepLinkDoneRef.current === decodedPost) return;
    const commentId = /comment=([^&#]+)/.exec(window.location.hash)?.[1];
    requestDeepLink(decodedPost, commentId ? decodeURIComponent(commentId) : null);
  }, [requestDeepLink]);

  useEffect(() => {
    readDeepLinkHash();
    // The hash can change without a remount (the app is not a router): a
    // permalink clicked inside the running app only fires hashchange.
    window.addEventListener('hashchange', readDeepLinkHash);
    return () => window.removeEventListener('hashchange', readDeepLinkHash);
  }, [readDeepLinkHash]);

  // A pending deep link opens as soon as the post reaches the list — targeted
  // read, background sync, or a peer announcement.
  useEffect(() => {
    const pending = pendingDeepLinkRef.current;
    if (!pending) return;
    openFromDeepLink(pending.postId, pending.commentId);
  }, [posts, openFromDeepLink]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ postId?: string; commentId?: string }>).detail;
      const postId = detail?.postId;
      if (!postId) return;
      // The hash may be unchanged; the intent is new, so allow a re-open.
      deepLinkDoneRef.current = null;
      pendingDeepLinkRef.current = null;
      requestDeepLink(postId, detail?.commentId ?? null);
    };
    window.addEventListener('gmatch-open-post', onOpen);
    return () => window.removeEventListener('gmatch-open-post', onOpen);
  }, [requestDeepLink]);

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

  const handleNameClick = (userId: string) => {
    playPress(750);
    onSelectUser?.(userId);
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
    // The displayed count follows the POST. Only a value produced by the
    // user's own like action outranks it, and only until the post moves.
    // Retirement happens out here: a state updater must stay pure, and
    // StrictMode invokes updaters twice.
    //
    // Both maps are REBUILT from the current list, never appended to: a post
    // that scrolls away leaves nothing behind, so a long session cannot grow
    // an unbounded map of ids the feed no longer shows.
    const live = new Set(posts.map((p) => p.id));
    for (const [id, g] of Array.from(governedLikeCounts.current)) {
      if (!live.has(id)) {
        governedLikeCounts.current.delete(id); // post is gone from the feed
        continue;
      }
      const postCount = initialCounts[id];
      if (postCount === undefined) continue; // not in the list right now
      if (postCount === g.override || postCount !== g.postAt) {
        governedLikeCounts.current.delete(id); // post agrees, or has moved on
      }
    }
    postedLikeCounts.current = new Map(posts.map((p) => [p.id, p.like_count ?? 0]));
    const counts: Record<string, number> = { ...initialCounts };
    for (const [id, g] of governedLikeCounts.current) counts[id] = g.override;
    setLikeCounts(counts);
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

  // Background publish work, counted in ONE pass (the label used to filter
  // the whole list twice on every render).
  const syncCounts = useMemo(() => {
    let pending = 0;
    let local = 0;
    for (const p of posts) {
      if (p.sync_state === 'pending') pending++;
      else if (p.sync_state === 'local') local++;
    }
    return { pending, local };
  }, [posts]);

  // Algorithmic Sorting. Latest is strictly chronological; Trending is a
  // deterministic engagement + tag-affinity score with recency decay, matching
  // the server's scoring intent (see /api/posts).
    // The timeline is filtered once and sorted once. The two sorts are separate
  // memos so the minute tick behind relative timestamps only re-ranks the
  // "for you" order — the "latest" order does not depend on the clock at all.
  // "No preview" is not content. A post whose media never resolves is
  // dropped from the timeline instead of filling it with empty frames.
  const [deadPosts, setDeadPosts] = useState<Set<string>>(new Set());
  // A row with NO words is only content once its bytes are real. Until then it
  // must not appear (and must not flash): it renders hidden, off the visible
  // list, and is promoted by the media itself. A failure drops it for good
  // (`hidePost`), so a post never sits in the timeline as an empty frame.
  const [mediaReady, setMediaReady] = useState<Set<string>>(new Set());
  const promoteMedia = useCallback((id: string) => {
    setMediaReady((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const hidePost = useCallback((id: string) => {
    setDeadPosts((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  // A text-less row must not appear (or flash) while its bytes are in flight.
  // The card cannot probe itself: a hidden card has no box, so the lazy image
  // never intersects and the row would wait forever. This is the one probe.
  useEffect(() => {
    let live = true;
    for (const post of posts) {
      if (post.caption?.trim()) continue;
      if (mediaReady.has(post.id) || deadPosts.has(post.id)) continue;
      const url = post.media?.[0]?.url || post.url;
      if (!url || !/^https?:|^\//i.test(url)) continue; // inline or descriptor: no probe
      if (hasInlineMedia(post)) continue;
      const img = new Image();
      img.onload = () => { if (live) promoteMedia(post.id); };
      img.onerror = () => { if (live) hidePost(post.id); };
      img.src = resolveMediaUrl(url);
    }
    return () => { live = false; };
  }, [posts, mediaReady, deadPosts, promoteMedia, hidePost]);

  const hiddenCount = useMemo(() => countHidden(posts), [posts]);
  const visiblePosts = useMemo(
    () => posts.filter((p) => {
      if (p.is_archived) return false;
      // No words, no url, no media = no post. Never a card, never a slot.
      if (!isRenderable(p)) return false;
      // Words carry the row on their own. Bytes that are already inline
      // (data:/blob:) need no probe; anything else must arrive first.
      if (!p.caption?.trim() && !mediaReady.has(p.id) && !hasInlineMedia(p)) return false;
      // Media that cannot be fetched right now keeps the post on screen (its
      // tile shows the placeholder). Hiding the whole post here is what made a
      // user's own old uploads disappear when no seeder held the bytes.
      return true;
    }),
    [posts, mediaReady],
  );

  // Hold the reader's place when rows arrive above them.
  //
  // The timeline is newest-first, so a post published while you are reading
  // is inserted at the very top, 4000px above your viewport. Chromium's
  // scroll anchoring is supposed to absorb that, but a row with
  // `content-visibility: auto` has no box while it is skipped, so the anchor
  // node can vanish and the page jumps by exactly the inserted height. Doing
  // the arithmetic here is deterministic and costs one layout read per
  // prepend.
  const listRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<{ id?: string; top: number }>({ top: 0 })
  const firstPostId = visiblePosts[0]?.id
  useLayoutEffect(() => {
    const el = listRef.current
    const scroller = el?.closest<HTMLElement>('.mobile-app-scroll')
    if (!el || !scroller) return
    const top = el.getBoundingClientRect().top
    const prev = anchorRef.current
    if (prev.id && prev.id !== firstPostId && scroller.scrollTop > 0) {
      const inserted = top - prev.top
      // Only a prepend (content pushed DOWN) is compensated; a removal above
      // would otherwise scroll the reader backwards.
      if (inserted > 0) scroller.scrollTop += inserted
    }
    anchorRef.current = { id: firstPostId, top: el.getBoundingClientRect().top }
  }, [firstPostId])

  // The timestamp is parsed ONCE per post, not inside every comparator call.
  const latestPosts = useMemo(() => {
    const stamped = visiblePosts.map((p) => ({ p, t: Date.parse(p.created_at) || 0 }));
    stamped.sort((a, b) => b.t - a.t);
    return stamped.map((s) => s.p);
  }, [visiblePosts]);

  const rankedPosts = useMemo(() => {
    const stamped = visiblePosts.map((p) => ({ p, t: Date.parse(p.created_at) || 0 }));
    const score = (s: { p: FeedPost; t: number }): number => {
      const ageHours = Math.max(1, (now - s.t) / (1000 * 60 * 60));
      const likes = likeCounts[s.p.id] ?? s.p.like_count ?? 0;
      const comments = commentsMap[s.p.id]?.length || s.p.comment_count || 0;
      let tagScore = 0;
      if (s.p.tags) {
        s.p.tags.forEach((t) => { tagScore += tagAffinities[t.toLowerCase()] || 0; });
      }
      return (likes * 2 + comments * 3 + tagScore * 4) / Math.pow(ageHours, 0.6);
    };
    stamped.sort((a, b) => {
      const scoreA = score(a);
      const scoreB = score(b);
      if (scoreA !== scoreB) return scoreB - scoreA;
      return b.t - a.t;
    });
    return stamped.map((s) => s.p);
  }, [visiblePosts, likeCounts, commentsMap, tagAffinities, now]);

  const displayPosts = feedSort === 'latest' ? latestPosts : rankedPosts;

  const followSuggestions = useMemo(
    () => displayPosts.length === 0
      ? suggestFollows(users ?? [], identity?.orbitId, myProfileTags, new Set(followingIds))
      : [],
    [displayPosts.length, users, identity?.orbitId, myProfileTags, followingIds],
  );

  // The empty state is four different situations, not one. Collapsing them made
  // a blind courier (no feed route) look like a genuinely quiet timeline, and a
  // failed read look like "nobody posted".
  const emptyCopy = useMemo(() => {
    switch (feedStatus) {
      case 'loading':
      case 'idle':
        return {
          title: 'Loading the feed…',
          body: 'Reading the first page.',
        };
      case 'offline':
        return {
          title: 'This node hosts no feed.',
          body: 'Your uploads and posts received from peers still appear here.',
        };
      case 'error':
        return {
          title: 'Could not read the feed.',
          body: 'Retry, or keep reading what is already local.',
        };
      default:
        return {
          title: 'No posts yet.',
          body: 'Upload a post, or join a node that has some.',
        };
    }
  }, [feedStatus]);

  // First-like chime: session-local celebration when MY post crosses 0 -> 1
  // likes after mount. Pre-liked posts at mount are seeded into the baseline
  // ref so reloads don't re-celebrate old news. The chime is the whole
  // celebration: the old "First like" badge printed a label over the media.
  //
  // The crossing is read from the POST's own count, tracked here. It used to be
  // read from `likeCounts`, which lagged the post on purpose — but that same lag
  // is what froze a stale count on screen, and the display now follows the post.
  const firstLikedBaseline = useRef<Set<string> | null>(null)
  const lastPostedLikeCounts = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    if (!identity?.orbitId) return
    if (firstLikedBaseline.current === null) {
      firstLikedBaseline.current = new Set(
        posts.filter((p) => p.author_id === identity.orbitId && (p.like_count ?? 0) > 0).map((p) => p.id),
      )
      for (const p of posts) lastPostedLikeCounts.current.set(p.id, p.like_count ?? 0)
      return
    }
    for (const p of posts) {
      if (p.author_id !== identity.orbitId) continue
      const prev = lastPostedLikeCounts.current.get(p.id)
      const next = p.like_count ?? 0
      lastPostedLikeCounts.current.set(p.id, next)
      if (prev === undefined) continue
      if (firstLikeCrossed(prev, next) && !firstLikedBaseline.current.has(p.id)) {
        firstLikedBaseline.current.add(p.id)
        playLikeOnce()
      }
    }
  }, [posts, identity?.orbitId])

  const toggleLike = useCallback((post: FeedPost) => {
    playPress(820);
    // Single-flight-per-post reconciliation (see utils/likeReconcile): the
    // persist runs exactly once per gesture outside any setState updater, a
    // generation per post discards stale resolutions, failures roll back,
    // and the feed GET cache is invalidated only on fresh success.
    likeGov.current!.toggle(
      post.id,
      !!likedPosts[post.id],
      likeCounts[post.id] ?? post.like_count ?? 0,
      {
        persist: onPersistLike ?? undefined,
        tags: post.tags,
        localOnly: post.is_sponsored,
        onOptimisticLike: (_id, tags) => boostTagAffinity(tags),
      },
    );
  }, [boostTagAffinity, onPersistLike, likedPosts, likeCounts]);

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

  /** B6: one-click Vault save of the post's media bytes. The bridge fetches,
   *  hashes and stores them (dedup by content hash); null = unreachable or
   *  browser dev (where the button is hidden anyway). */
  const vaultSavedRef = useRef<Set<string>>(new Set());
  const [vaultSaved, setVaultSaved] = useState<Set<string>>(new Set());
  const savePostToVault = async (post: FeedPost) => {
    const url = post.url;
    if (!url || vaultSavedRef.current.has(url)) return;
    vaultSavedRef.current.add(url); // in-flight + done guard
    try {
      const local = await vaultPin(url);
      if (local) {
        setVaultSaved((prev) => new Set(prev).add(url));
        toast?.('Media saved to your Vault — it opens even offline.', 'success');
      } else {
        vaultSavedRef.current.delete(url);
        toast?.('Could not save to the Vault: the media was unreachable.', 'error');
      }
    } catch {
      vaultSavedRef.current.delete(url);
      toast?.('Could not save to the Vault.', 'error');
    }
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

  const handleAddComment = (postId: string, textToAdd?: string, parentCommentId?: string | null) => {
    const text = (textToAdd || '').trim();
    if (!text) return;
    playMsgReceive();

    const post = posts.find((p) => p.id === postId);
    if (post) boostTagAffinity(post.tags);

    // Sponsored posts have no persist path, so a "Comment posted!" toast there
    // was claiming a write that never happened.
    if (post?.is_sponsored) {
      toast?.('Comments are closed on sponsored posts', 'info');
      return;
    }

    const draftId = `c_pending_${Date.now()}`;
    const draft: PostComment = {
      id: draftId,
      author_id: identity?.orbitId || 'me',
      author_name: 'You',
      author_avatar: profilePics[identity?.orbitId || ''],
      text,
      // A real timestamp, not the literal string "Just now" that then sat next
      // to server rows formatted as "2026-09-28 12:34:56".
      created_at: new Date().toISOString(),
      like_count: 0,
      ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}),
      pending: true,
    };
    setCommentsMap((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), draft] }));

    const dropDraft = (message: string) => {
      setCommentsMap((prev) => ({
        ...prev,
        [postId]: (prev[postId] || []).filter((c) => c.id !== draftId),
      }));
      toast?.(message, 'error');
    };

    const persist = onPersistComment?.(postId, text, parentCommentId ?? null);
    if (!persist) {
      // No persist handler wired: nothing to confirm against, so keep the row
      // rather than silently deleting the user's comment.
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
            [postId]: (prev[postId] || []).map((c) => (c.id === draftId ? { ...serverComment, pending: false } : c)),
          }));
        } else {
          // persistComment returns null on any failure; keeping the draft would
          // show a comment that does not exist on the server.
          dropDraft('Comment not saved — try again');
        }
      })
      .catch(() => dropDraft('Comment not saved — try again'));
  };

  // The server route is like-only and idempotent (INSERT OR IGNORE, no unlike
  // endpoint), so this does NOT pretend to toggle: an already-liked comment is
  // left alone, and the server's own count is what lands in state.
  const handleToggleCommentLike = (postId: string, commentId: string) => {
    const target = (commentsMap[postId] || []).find((c) => c.id === commentId);
    if (!target || target.pending) return;
    if (target.is_liked) {
      toast?.('Likes on comments cannot be undone', 'info');
      return;
    }
    if (!identity) return;
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
              : c
          ),
        }));
      })
      .catch(() => toast?.('Could not like that comment', 'error'));
  };

  const handleCopyLink = (post: FeedPost) => {
    playPress(800);
    void navigator.clipboard.writeText(postShareUrl(post.id));
    toast?.('Post link copied to clipboard!', 'success');
    setOptionsPost(null);
  };

  // Fetch the comments for the post that is open — lightbox (profile grids,
  // Etapa B) or inline expansion. Keyed on the post that is actually open.
  //
  // This used to be keyed on `activeCommentsPostId`, which was only ever
  // initialised to null and reset to null — nothing in the app ever assigned a
  // post id to it. So the fetch could not run, `CommentsModal` was unreachable,
  // and the lightbox (the ONLY comment surface a user can reach) rendered an
  // always-empty list. Keyed on the post that is actually open instead.
  const lightboxPostId = expandedPostId;
  useEffect(() => {
    if (!lightboxPostId || !identity) return;
    if (commentsLoadedRef.current.has(lightboxPostId)) return;
    let cancelled = false;
    setCommentsLoadingId(lightboxPostId);
    orbitFetch(`/api/posts/${lightboxPostId}/comments`, {}, identity)
      .then(async (res) => {
        if (!res.ok) return;
        const list = await res.json();
        if (cancelled || !Array.isArray(list)) return;
        setCommentsMap((prev) => ({ ...prev, [lightboxPostId]: list }));
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        // Marked loaded even on failure: a post with no accessible comments must
        // not be re-requested on every open, and the empty state is the truth.
        commentsLoadedRef.current.add(lightboxPostId);
        setCommentsLoadingId(null);
      });
    return () => { cancelled = true; };
  }, [lightboxPostId, identity]);

  return (
    <div className="w-full flex flex-col font-sans select-none pb-12 text-retro-fg">
      {/* Feed Top Header — sort tabs, grid 1-5, search. Notifications live in
          the single header centre, so this bar carries no bell. */}
      <FeedHeader
        onRefresh={onForceRefresh ? () => { onForceRefresh(); } : undefined}
        onOpenSearch={() => setShowExploreSearch(true)}
        onPingAttention={onPingAttention}
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
        layoutToggle={
          <div
            role="group"
            aria-label="Feed layout"
            className="flex items-center rounded-md bg-glass-w5 border border-border-glass p-0.5"
          >
            {(['list', 'grid'] as const).map((layout) => (
              <button
                key={layout}
                type="button"
                onClick={() => { playPress(720); onFeedLayoutChange?.(layout); }}
                aria-pressed={feedLayout === layout}
                title={layout === 'list' ? 'Timeline' : 'Grid'}
                aria-label={layout === 'list' ? 'Timeline layout' : 'Grid layout'}
                className={`p-1.5 rounded transition-colors duration-150 cursor-pointer ${feedLayout === layout
                    ? 'bg-glass-w20 text-retro-fg'
                    : 'text-retro-muted hover:text-retro-fg'
                  }`}
              >
                {layout === 'list' ? <Rows3 className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
              </button>
            ))}
          </div>
        }
      />

      {/* Selective status pills: only empty/conflict states, never a
          healthy timeline (see FeedStatusPills). */}
      <FeedStatusPills />

      {/* Dev-only census: rows dropped for having no content at all. It is
          the honest way to see that the predicate, not the network, is
          what emptied the timeline. */}
      {import.meta.env.DEV && hiddenCount > 0 && (
        <div className="px-3 sm:px-6 pt-1 text-2xs text-retro-faint" data-testid="feed-hidden-count">
          {hiddenCount} hidden: no content
        </div>
      )}

      {/* ONE quiet sync label (replaces the per-post chips): reflects real
          background publish work — active uploads / posts saved locally only.
          Non-blocking, no layout shift beyond this single row. */}
      {syncCounts.pending > 0 || syncCounts.local > 0 ? (
        <div
          role="status"
          className="w-full py-1 px-3 flex items-center gap-1.5 text-2xs font-mono text-retro-muted border-b border-border-glass bg-glass-w4 select-none"
        >
          {syncCounts.pending > 0 ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin shrink-0" aria-hidden="true" />
              <span>Syncing {syncCounts.pending} post{syncCounts.pending === 1 ? '' : 's'} to the network…</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400/90 shrink-0" aria-hidden="true" />
              <span>
                {syncCounts.local} post{syncCounts.local === 1 ? '' : 's'} saved on this device — they upload when the network is back.
              </span>
            </>
          )}
        </div>
      ) : null}


      {/* Discreet grey loading label when stories/content are loading */}
      {storiesLoading && (
        <div className="w-full py-1.5 px-3 flex items-center justify-center gap-1.5 text-2xs font-mono text-retro-muted border-b border-border-glass bg-glass-w4 select-none">
          <Loader2 className="w-3 h-3 animate-spin text-retro-muted shrink-0" />
          <span>Loading content...</span>
        </div>
      )}

      {/* Stories Tray Carousel — below the header */}
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

      {/* Feed Content Column (Posts) */}
      <div className="w-full flex flex-col px-2 sm:px-4 py-2 space-y-3">
        {/* Feed Posts List with Sharp Square Images */}
                  <div
                    ref={listRef}
                    className={feedLayout === 'grid' ? 'mt-3' : 'mt-3 mx-auto w-full max-w-[600px]'}
                    data-feed-layout={feedLayout}
                  >
           {feedLayout === 'grid' ? (
             <FeedGrid
               posts={visiblePosts}
               identity={identity}
               profilePics={profilePics}
               likedPosts={likedPosts}
               likeCounts={likeCounts}
               onToggleLike={toggleLike}
               onOpen={(post) => { toggleExpand(post); }}
             />
           ) : (
             <>
           {visiblePosts.map((post, _idx) => {
              if (deadPosts.has(post.id)) return null;
            const isLiked = !!likedPosts[post.id];
            const isSaved = !!savedPosts[post.id];
             const currentLikes = likeCounts[post.id] ?? post.like_count ?? 0;
             // The preview only names OTHER people; while I am the only liker
             // (or the summary would read "Liked by me") the bare count shows.
             const likersPreview = isLiked
               ? post.likers?.filter((l) => l.user_id !== identity?.orbitId)
               : post.likers;
             const likedByLabel = formatLikedBy(likersPreview, currentLikes);

            // Node rows and peer operations live in two places; the thread
            // is the union, deduped by id (a node row wins: it carries the
            // display name and the avatar).
            const postComments = mergeCommentRows(
              commentsMap[post.id] || [],
              peerComments.get(post.id) || [],
            );
            // Server truth for the count; the local map is only warm once the
            // post has been opened (inline expansion or lightbox).
            const postCommentCount = Math.max(post.comment_count ?? 0, postComments.length);
            const authorHasStory = storyOwners.has(post.author_id);
            const isObjectMedia = post.url.includes('/api/objects/') || post.url.startsWith('vault://') || !post.url || post.url.startsWith('magnet:') || post.url.startsWith('urn:sha256:') || post.url.startsWith('p2p-');
            const isVideo = isVideoPost(post.mime_type, post.url, siblingMimesFor(post));
           const isNewPost = animatedPostIds.has(post.id);
           const multiMedia = Array.isArray(post.media) && post.media.length > 1 ? post.media : null;
            const currentIdx = multiMedia ? Math.min(Math.max(0, mediaIdx[post.id] || 0), multiMedia.length - 1) : 0;
            const expanded = expandedPostId === post.id;

            return post.is_sponsored ? (
              <article
                key={post.id}
                className={`bg-retro-panel border border-border-glass rounded-lg overflow-hidden flex flex-col shadow-xs mb-3 break-inside-avoid ${isNewPost ? 'animate-orbit-feed-in' : ''}`}
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
                  className={`relative w-full aspect-[4/5] max-h-[min(420px,60vh)] bg-gradient-to-br ${GAME_AD_TEMPLATES.find((t) => t.mode === post.game_mode)?.gradient || 'from-zinc-800 to-zinc-900'} flex flex-col items-center justify-center text-retro-fg overflow-hidden`}
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
                data-post-id={post.id}
                onContextMenu={(e) => { e.preventDefault(); setOptionsPost(post) }}
                className={`cv-row relative bg-surface-raised border border-border-glass rounded-[10px] overflow-hidden flex flex-col mb-3 break-inside-avoid ${isNewPost ? 'animate-orbit-feed-in' : ''}`}
              >
                {/* Repost attribution: a quiet line, not a filled band, so the
                    post reads as one media-first tile, Instagram-style. */}
                {post.is_reposted && (
                  <div className="flex items-center gap-1.5 px-3 pt-2.5 text-xs text-retro-muted">
                    <Repeat className="w-3.5 h-3.5 text-retro-fg" />
                    <span>Reposted by <strong className="text-retro-fg font-medium">@{post.reposted_by || 'Peer'}</strong></span>
                  </div>
                )}

                {/* One header row per post: avatar, name, handle, time, menu.
                    It used to be a gradient painted over the picture, which
                    drew the author and "No preview" on the same line. */}
                <div
                  data-testid="post-author-overlay"
                  className="flex items-center gap-3 px-3 pt-3 pb-2"
                  onContextMenu={(e) => onUserContext?.(e, post.author_id, post.author_name)}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleAvatarClick(post.author_id); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleAvatarClick(post.author_id)}
                    title={authorHasStory ? 'Watch story' : 'View profile'}
                    aria-label={authorHasStory ? `Watch story of ${post.author_name}` : `View profile of ${post.author_name}`}
                    className={`relative w-10 h-10 rounded-full p-[2px] flex-shrink-0 cursor-pointer ${authorHasStory ? 'bg-retro-accent' : 'bg-transparent'}`}
                  >
                    <div className="relative w-full h-full rounded-full bg-surface-raised overflow-hidden">
                      <Avatar id={post.author_id} size={40} imageUrl={profilePics[post.author_id] || post.author_avatar} fill={true} />
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); handleNameClick(post.author_id); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleNameClick(post.author_id)}
                      className="truncate text-sm font-semibold text-retro-fg hover:underline cursor-pointer"
                    >
                      {post.author_name || generateFallbackName(post.author_id)}
                    </span>
                    <span className="shrink-0 text-xs text-retro-faint">@{post.author_id.slice(0, 8)}</span>
                    <span className="shrink-0 text-xs text-retro-faint" aria-hidden="true">·</span>
                    <PostTimestamp createdAt={post.created_at} className="shrink-0 text-xs text-retro-faint" />
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setOptionsPost(post); }}
                    className="shrink-0 p-1.5 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w10 cursor-pointer transition-colors"
                    aria-label="Post options"
                    title="Post options"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>

                {/* Body: the words are content, so they sit above the media
                    (Twitter order) instead of under the action row. */}
                {post.caption ? (
                  <p className="px-3 pb-2 text-[15px] leading-5 text-retro-body whitespace-pre-wrap break-words">
                    <Linkify text={post.caption} />
                  </p>
                ) : null}

                {/* Media. A post with no bytes at all renders nothing here
                    (no empty frame, no "No preview"). */}
                {!post.url && !post.localPreviewUrl ? null : (() => {
                  const activeItem = multiMedia ? multiMedia[currentIdx] : null;
                  const activeUrl = activeItem ? activeItem.url : post.url;
                  const activeMime = activeItem ? activeItem.mime_type : post.mime_type;
                  const isCurrentVideo = isVideoPost(activeMime, activeUrl, siblingMimesFor(post));

                  return (
                    <div
                      className="group/post relative w-full bg-surface-canvas flex items-center justify-center overflow-hidden rounded-none transition-[max-height] duration-300 ease-out motion-reduce:transition-none"
                      data-expanded={expanded}
                    >
                      {/* The expand surface is the MEDIA ONLY: the author
                          overlay below is a sibling, so its controls can never
                          bubble into "expand the post". */}
                      <div
                        role="button"
                        tabIndex={0}
                        aria-expanded={expanded}
                        aria-label={expanded ? 'Post image, expanded' : 'Expand post'}
                        className={`w-full ${isCurrentVideo ? '' : 'cursor-pointer'}`}
                        onClick={() => {
                          if (!isCurrentVideo) {
                            toggleExpand(post);
                          }
                        }}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && !isCurrentVideo) {
                            e.preventDefault();
                            toggleExpand(post);
                          }
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleDoubleTap(post);
                        }}
                      >
                      {/* Zoom applies on the media node only (controls stay put);
                          transform never affects layout, so zoom can't move
                          the reader's scroll position. */}
                      <div
                        className="w-full flex items-center justify-center transition-transform duration-300 ease-out motion-reduce:transition-none"
                        style={expanded && zoomLevel > 1 ? { transform: `scale(${zoomLevel})` } : undefined}
                      >
                      {multiMedia ? (() => {
                        const item = multiMedia[currentIdx];
                        const url = item.url;
                        const mime = item.mime_type;
                        const isObj = url.includes('/api/objects/') || url.startsWith('vault://') || !url || url.startsWith('magnet:') || url.startsWith('urn:sha256:') || url.startsWith('p2p-');
                        const isVid = isVideoPost(mime, url, siblingMimesFor(post));
                        return (
                          <>
                            {isObj ? (
                              <ObjectImage
                                objectId={item.id}
                                contentUrl={url}
                                identity={identity}
                                mimeType={mime}
                                className="w-full h-auto max-h-[min(680px,80vh)] group-data-[expanded=true]/post:max-h-[85vh] object-contain rounded-none"
                                videoClassName="w-full max-h-[min(680px,80vh)] group-data-[expanded=true]/post:max-h-[85vh] object-contain rounded-none"
                                controls={true}
                                alwaysShowControls={true}
                                autoPlay={true}
                                muted={true}
                                loop={true}
                                hideUnavailable={false}
                          onMediaUnavailable={() => hidePost(post.id)}
                        onLoad={() => promoteMedia(post.id)}
                                onExpand={() => toggleExpand(post)}
                                onDoubleTapLike={() => handleDoubleTap(post)}
                              />
                            ) : isVid ? (
                              <NativeVideoPlayer
                                natural
                                src={url}
                                videoClassName="w-full max-h-[min(680px,80vh)] group-data-[expanded=true]/post:max-h-[85vh] object-contain rounded-none"
                                controls={true}
                                alwaysShowControls={true}
                                autoPlay={true}
                                muted={true}
                                loop={true}
                                onExpand={() => toggleExpand(post)}
                                onDoubleTapLike={() => handleDoubleTap(post)}
                              />
                            ) : (
                              <CachedImg
                                src={url}
                                alt={post.caption || 'Post image'}
                                className="w-full h-auto max-h-[min(680px,80vh)] group-data-[expanded=true]/post:max-h-[85vh] object-contain rounded-none"
                                loading="lazy"
                              />
                            )}
                          </>
                        );
                      })() : post.localPreviewUrl ? (
                        // Own fresh post: session blob URL renders instantly
                        // with zero fetch while server/swarm catch up.
                        isVideo ? (
                          <NativeVideoPlayer
                                natural
                                src={post.localPreviewUrl}
                            videoClassName="w-full max-h-[min(680px,80vh)] group-data-[expanded=true]/post:max-h-[85vh] object-contain rounded-none"
                            controls={true}
                            alwaysShowControls={true}
                            autoPlay={true}
                            muted={true}
                            loop={true}
                            onExpand={() => toggleExpand(post)}
                            onDoubleTapLike={() => handleDoubleTap(post)}
                          />
                        ) : (
                          <img
                            src={post.localPreviewUrl}
                            alt={post.caption || 'Post image'}
                            className="w-full h-auto max-h-[min(680px,80vh)] group-data-[expanded=true]/post:max-h-[85vh] object-contain rounded-none"
                            draggable={false}
                          />
                        )
                      ) : isObjectMedia ? (
                        <ObjectImage
                          objectId={post.id}
                          contentUrl={post.url}
                          identity={identity}
                          mimeType={post.mime_type}
                          className="w-full h-auto max-h-[min(680px,80vh)] group-data-[expanded=true]/post:max-h-[85vh] object-contain rounded-none"
                          videoClassName="w-full max-h-[min(680px,80vh)] group-data-[expanded=true]/post:max-h-[85vh] object-contain rounded-none"
                          controls={true}
                          alwaysShowControls={true}
                          autoPlay={true}
                          muted={true}
                          loop={true}
                          hideUnavailable={false}
                          onExpand={() => toggleExpand(post)}
                          onDoubleTapLike={() => handleDoubleTap(post)}
                        onMediaUnavailable={() => hidePost(post.id)}
                        onLoad={() => promoteMedia(post.id)}
                          />
                      ) : isVideo ? (
                        <NativeVideoPlayer
                                natural
                                src={post.url}
                          videoClassName="w-full max-h-[min(680px,80vh)] group-data-[expanded=true]/post:max-h-[85vh] object-contain rounded-none"
                          controls={true}
                          alwaysShowControls={true}
                          autoPlay={true}
                          muted={true}
                          loop={true}
                          onExpand={() => toggleExpand(post)}
                          onDoubleTapLike={() => handleDoubleTap(post)}
                        />
                      ) : (
                        <CachedImg
                          src={post.url}
                          alt={post.caption || 'Post image'}
                          className="w-full h-auto max-h-[min(680px,80vh)] group-data-[expanded=true]/post:max-h-[85vh] object-contain rounded-none"
                          loading="lazy"
                          onLoad={() => promoteMedia(post.id)}
                        />
                      )}
                        </div>
                      </div>


                      {/* Zoom + collapse overlays (expanded only) */}
                      {expanded && (
                        <>
                          <button
                            type="button"
                            aria-label="Collapse post"
                            onClick={(e) => { e.stopPropagation(); toggleExpand(post); }}
                            className="absolute left-2 top-2 z-10 w-8 h-8 rounded-full bg-black/45 backdrop-blur-sm text-retro-fg flex items-center justify-center hover:bg-black/70 transition-colors cursor-pointer"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={zoomLevel > 1 ? 'Reset zoom' : 'Zoom image'}
                            onClick={(e) => {
                              e.stopPropagation();
                              playPress(700);
                              setZoomLevel((z) => (z === 1 ? 1.8 : z === 1.8 ? 2.6 : 1));
                            }}
                            className="absolute bottom-2 right-2 z-10 h-8 pl-2.5 pr-3 rounded-full bg-black/60 backdrop-blur-sm text-retro-fg flex items-center gap-1.5 hover:bg-black/70 transition-colors cursor-pointer"
                          >
                            {zoomLevel > 1 ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
                            <span className="font-mono text-2xs">{Math.round(zoomLevel * 100)}%</span>
                          </button>
                        </>
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
                            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/45 backdrop-blur-sm text-retro-fg flex items-center justify-center hover:bg-black/70 transition-colors cursor-pointer"
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
                            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/45 backdrop-blur-sm text-retro-fg flex items-center justify-center hover:bg-black/70 transition-colors cursor-pointer"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                          <div className="absolute top-2.5 right-2.5 z-10 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-xs text-2xs font-medium text-retro-fg/90">
                            {currentIdx + 1}/{multiMedia.length}
                          </div>
                        </>
                      )}

                      {/* Double Tap Heart Pop Animation */}
                      {doubleTapAnimationId === post.id && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 animate-orbit-pop">
                          <Heart className="w-20 h-20 text-retro-fg fill-white opacity-90" />
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Action row: no fill, no separator — it sits directly under
                    the media so the whole tile reads as one object. */}
                <div className="px-3 sm:px-4 pt-2.5 pb-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleLike(post)}
                        aria-label="Like post"
                        aria-pressed={isLiked}
                        className="p-1.5 rounded-md hover:bg-glass-w10 cursor-pointer transition-transform duration-150 active:scale-[0.98]"
                      >
                        <Heart
                          className={`w-4 h-4 transition-colors stroke-[1.75] ${isLiked ? 'text-rose-500 fill-rose-500' : 'text-retro-muted hover:text-retro-fg'
                            }`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleExpand(post)}
                        aria-label="Comment"
                        className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w10 cursor-pointer transition-transform duration-150 active:scale-[0.98]"
                      >
                        <MessageCircle className="w-4 h-4 stroke-[1.75]" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setSharingPost(post)}
                        aria-label="Share post"
                        className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w10 cursor-pointer transition-transform duration-150 active:scale-[0.98]"
                      >
                        <Send className="w-4 h-4 stroke-[1.75]" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleSave(post)}
                      aria-label="Save post"
                      className="p-1.5 rounded-md hover:bg-glass-w10 cursor-pointer transition-transform duration-150 active:scale-[0.98]"
                    >
                      <Bookmark
                        className={`w-4 h-4 transition-colors stroke-[1.75] ${isSaved ? 'text-retro-fg fill-retro-fg' : 'text-retro-muted hover:text-retro-fg'
                          }`}
                      />
                    </button>

                    {/* Save media bytes to the local Vault (desktop only):
                        one click, no modal, deduped by the vault's content
                        hash. Hidden in browser dev where the bridge is absent
                        — it would never be functional there. */}
                    {vaultBridge() && post.url && (
                      <button
                        type="button"
                        onClick={() => void savePostToVault(post)}
                        aria-label="Save to Vault"
                        title="Save the media to your Vault (offline copy)"
                        className="p-1.5 rounded-md hover:bg-glass-w10 cursor-pointer transition-transform duration-150 active:scale-[0.98]"
                      >
                        <FolderPlus
                          className={`w-4 h-4 stroke-[1.75] transition-colors ${vaultSaved.has(post.url) ? 'text-emerald-400' : 'text-retro-muted hover:text-retro-fg'}`}
                        />
                      </button>
                    )}
                  </div>

                  {/* Likes: named likers when the row carries them, otherwise the
                      bare count. Zero is not shown as a datum. */}
                  {(likedByLabel || currentLikes > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        playPress(700);
                        setLikersModalPostId(post.id);
                      }}
                      className="text-left text-xs text-retro-muted hover:text-retro-fg hover:underline cursor-pointer w-fit transition-colors"
                      aria-label="View who liked this post"
                    >
                      {likedByLabel || `${currentLikes.toLocaleString()} ${currentLikes === 1 ? 'like' : 'likes'}`}
                    </button>
                  )}

                  {(
                  <>
                  {/* Tag Badges */}
                  {post.tags && post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {post.tags.map((t) => (
                        <span
                          key={t}
                          onClick={() => boostTagAffinity([t])}
                          className="text-xs font-mono px-1.5 py-0.5 rounded bg-glass-w12 text-retro-body hover:text-retro-fg cursor-pointer transition-colors"
                        >
                          #{t.replace(/^#/, '')}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Comments Trigger & Recent Preview.
                      The count comes from post.comment_count (server truth),
                      NOT from the local map: the map only fills once the
                      lightbox has been opened, so gating on it made every post
                      read "Add a comment..." even with a dozen replies. */}
                  {postCommentCount > 0 ? (
                    <div className="space-y-1 mt-0.5">
                      <button
                        type="button"
                        onClick={() => toggleExpand(post)}
                        className="text-left text-xs text-retro-muted hover:text-retro-fg cursor-pointer font-medium block"
                      >
                        View all {postCommentCount} comment{postCommentCount === 1 ? '' : 's'}
                      </button>

                      {/* Snippet: only once we've actually loaded the list. */}
                      {postComments.length > 0 && (
                        <div className="text-xs text-retro-fg flex items-center justify-between">
                          <div className="truncate">
                            <strong className="font-semibold text-retro-fg mr-1.5">{postComments[postComments.length - 1].author_name}</strong>
                            <span className="text-retro-muted"><Linkify text={postComments[postComments.length - 1].text} /></span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                  </>
                  )}
                </div>
              </article>
            );
          })}
             </>
           )}

          {displayPosts.length === 0 && (
            <div className="border border-border-glass rounded-lg p-10 text-center space-y-5 my-4 max-w-md mx-auto">
              <div>
                <h2 className="text-2xl font-black tracking-tighter text-retro-fg">{emptyCopy.title}</h2>
                <p className="text-xs text-retro-muted mt-2 leading-relaxed">
                  {emptyCopy.body}
                </p>
              </div>
              {onForceRefresh && (
                <button
                  type="button"
                  onClick={() => { playPress(800); onForceRefresh(); }}
                  className="px-4 py-2 text-xs font-semibold rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer inline-flex items-center gap-1.5 border border-border-glass text-retro-body hover:text-retro-fg hover:bg-glass-w10"
                >
                  <RefreshCw className="w-4 h-4 stroke-[2]" />
                  <span>Reload feed</span>
                </button>
              )}
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
                  <p className="text-2xs uppercase tracking-wider text-retro-muted mb-2">Or follow someone</p>
                  <div className="flex items-center justify-center gap-3">
                    {followSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { void onFollowSuggestion?.(s.id); }}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                        aria-label={`Follow ${s.display_name || s.id}`}
                      >
                        <span className="relative w-10 h-10 rounded-full overflow-hidden border border-border-glass flex items-center justify-center text-xs text-retro-fg bg-glass-w5">
                          <Avatar id={s.id} size={40} imageUrl={profilePics?.[s.id]} fill={true} />
                        </span>
                        <span className="text-2xs text-retro-muted truncate max-w-[72px] group-hover:text-retro-fg">{s.display_name}</span>
                        <span className="text-2xs text-retro-fg border border-border-glass rounded-md px-1.5 py-0.5 group-hover:bg-glass-w10">Follow</span>
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

      {/* ─── Comments side sheet: comments open "ao lado", never pushing the
              timeline down. The fetch is keyed on expandedPostId (above), so
              opening the sheet is all it takes for the thread to load. ─── */}
      {(() => {
        const expandedPost = expandedPostId ? visiblePosts.find((p) => p.id === expandedPostId) : null;
        if (!expandedPost) return null;
        const sheetComments = mergeCommentRows(
          commentsMap[expandedPost.id] || [],
          peerComments.get(expandedPost.id) || [],
        );
        return (
          <SideSheet
            open
            onClose={() => setExpandedPostId(null)}
            title={`Comments · ${expandedPost.author_name}`}
          >
            <PostComments
              key={expandedPost.id}
              post={expandedPost}
              comments={sheetComments}
              commentsLoading={commentsLoadingId === expandedPost.id}
              authorAvatar={profilePics[expandedPost.author_id]}
              onAuthorClick={() => handleAvatarClick(expandedPost.author_id)}
              onCommentAuthorClick={(authorId) => handleAvatarClick(authorId)}
              onAddComment={handleAddComment}
              onToggleCommentLike={handleToggleCommentLike}
              onReportComment={onReportComment}
              focusCommentId={focusCommentId}
            />
          </SideSheet>
        );
      })()}

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
          openInline(post, true);
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
      {cameraCropper}
    </div>
  );
}

/** Memoized: the feed is a pure function of its props. App re-renders on its
 *  own clock (idle tick, presence, roster), and rebuilding 500 cards because a
 *  counter moved is the difference between a 60fps list and a 1fps one. The
 *  props (useCallback/useMemo upstream) are the only reason to render. The cast
 *  only restores the signature `memo` cannot infer from a destructured
 *  parameter with defaults; the props contract is unchanged. */
export const GMatchFeed = memo(GMatchFeedImpl) as typeof GMatchFeedImpl
