"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { OrbitObject, Relationship } from '@orbit/shared';
import type { OrbitIdentity } from '@orbit/crypto';
import { orbitFetch } from '../utils/api';
import { useToast } from './Toast';
import { useNow } from '../hooks/useNow';
import { playPress, playLike } from '../utils/sounds';
import { ObjectImage } from './ObjectImage';
import { isMediaVideo, resolveMediaUrl } from '../utils/media';
import { LazyVideo } from './LazyVideo';
import {
  Heart,
  X,
  ChevronLeft,
  ChevronRight,
  Plus,
  MessageCircle,
} from 'lucide-react';

interface GMatchStoriesProps {
  stories: OrbitObject[];
  loading?: boolean;
  relationships?: Relationship[];
  currentUserId: string;
  identity?: OrbitIdentity | null;
  profilePics?: Record<string, string>;
  activeUserId?: string | null;
  onCloseActiveUser?: () => void;
  onAddStory?: () => void;
  onStartPm?: (user: { id: string; display_name?: string }) => void;
}

interface GroupedUserStories {
  userId: string;
  displayName: string;
  pfpUrl?: string;
  stories: OrbitObject[];
  hasUnseen: boolean;
  lastCreatedAt: string;
}

export function GMatchStories({ stories, loading = false, currentUserId, identity, profilePics = {}, activeUserId, onCloseActiveUser, onAddStory, onStartPm }: GMatchStoriesProps) {
  const { toast } = useToast();
  const [seenStoryIds, setSeenStoryIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem('orbit_seen_stories');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Server-side seen state (StoryViews) hydrates the localStorage mirror on
  // load, so a story watched on another device starts dimmed here too.
  useEffect(() => {
    const viewedIds = stories.filter((s) => s.viewed).map((s) => s.id);
    if (viewedIds.length === 0) return;
    setSeenStoryIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of viewedIds) if (!next.has(id)) { next.add(id); changed = true; }
      if (!changed) return prev;
      try {
        localStorage.setItem('orbit_seen_stories', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  }, [stories]);

  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [openOrder, setOpenOrder] = useState<string[] | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState<number>(0);
  const [isPaused, setIsPaused] = useState(false);
  // Avatar URLs that 404'd (e.g. deleted object refs) fall back to initials.
  const [pfpFailed, setPfpFailed] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState(0); // 0 to 100
  const [likedStories, setLikedStories] = useState<Set<string>>(new Set());
  const [floatingHearts, setFloatingHearts] = useState<{ id: number; x: number }[]>([]);
  const now = useNow(30_000);

  // Group stories by creator/owner
  const groupedUsers = useMemo<GroupedUserStories[]>(() => {
    const userMap = new Map<string, GroupedUserStories>();

    // Dedupe by story ID so reused media URLs do not hide separate stories.
    const cleanStories: OrbitObject[] = [];
    const seenIds = new Set<string>();
    for (const story of stories) {
      if (!story) continue;
      const hasUrl = typeof story.content_url === 'string' && story.content_url.trim().length > 0;
      const hasId = typeof story.id === 'string' && story.id.trim().length > 0;
      if (!hasUrl && !hasId) continue;
      if (seenIds.has(story.id)) continue;
      seenIds.add(story.id);
      cleanStories.push(story);
    }

    for (const story of cleanStories) {
      const uId = story.owner_id || 'unknown';
      const existing = userMap.get(uId);
      const isSeen = seenStoryIds.has(story.id);

      if (existing) {
        existing.stories.push(story);
        if (!isSeen) existing.hasUnseen = true;
        if (new Date(story.created_at) > new Date(existing.lastCreatedAt)) {
          existing.lastCreatedAt = story.created_at;
        }
      } else {
        userMap.set(uId, {
          userId: uId,
          displayName: story.display_name?.trim() || 'Unknown User',
          pfpUrl: story.pfp_url || profilePics[uId] || undefined,
          stories: [story],
          hasUnseen: !isSeen,
          lastCreatedAt: story.created_at || new Date().toISOString(),
        });
      }
    }

    const arr = Array.from(userMap.values());
    // Sort: unseen stories first, then most recent
    arr.sort((a, b) => {
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return new Date(b.lastCreatedAt).getTime() - new Date(a.lastCreatedAt).getTime();
    });

    return arr;
  }, [stories, seenStoryIds, profilePics]);

  const activeGroup = openUserId
    ? groupedUsers.find((g) => g.userId === openUserId) || null
    : null;
  const currentStory = activeGroup?.stories[activeStoryIndex] || null;

  const openUser = (userId: string) => {
    const idx = groupedUsers.findIndex((g) => g.userId === userId);
    if (idx === -1) return;
    setOpenOrder(groupedUsers.map((g) => g.userId));
    setOpenUserId(userId);
    setActiveStoryIndex(0);
    setProgress(0);
    setIsPaused(false);
  };

  // Mark story as seen
  const markAsSeen = (id: string) => {
    if (!id || seenStoryIds.has(id)) return;
    setSeenStoryIds((prev) => {
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem('orbit_seen_stories', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
    // Fire-and-forget cross-device record; the endpoint is idempotent.
    if (identity) {
      void orbitFetch(`/api/objects/${id}/view`, { method: 'POST' }, identity).catch(() => {});
    }
  };

  const closeStoryViewer = () => {
    setOpenUserId(null);
    setOpenOrder(null);
    setActiveStoryIndex(0);
    setProgress(0);
    setIsPaused(false);
    onCloseActiveUser?.();
  };

  const goToNextStory = () => {
    if (!openUserId || !activeGroup) return;
    if (activeStoryIndex < activeGroup.stories.length - 1) {
      setActiveStoryIndex((prev) => prev + 1);
      setProgress(0);
    } else if (openOrder) {
      const i = openOrder.indexOf(openUserId);
      const nextId = openOrder[i + 1];
      if (nextId) openUser(nextId);
      else closeStoryViewer();
    }
  };

  const goToPrevStory = () => {
    if (!openUserId || !activeGroup) return;
    if (activeStoryIndex > 0) {
      setActiveStoryIndex((prev) => prev - 1);
      setProgress(0);
    } else if (openOrder) {
      const i = openOrder.indexOf(openUserId);
      const prevId = openOrder[i - 1];
      if (prevId) {
        const prevGroup = groupedUsers.find((g) => g.userId === prevId);
        if (prevGroup) {
          openUser(prevId);
          setActiveStoryIndex(Math.max(0, prevGroup.stories.length - 1));
        }
      }
    }
  };

  // Story auto-advance timer (5 seconds)
  useEffect(() => {
    if (openUserId === null || !currentStory || isPaused) return;

    markAsSeen(currentStory.id);
    setProgress(0);

    const DURATION_MS = 5000;
    const INTERVAL_MS = 100;
    const step = (INTERVAL_MS / DURATION_MS) * 100;

    const timer = setInterval(() => {
      if (document.hidden) return
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(timer);
          goToNextStory();
          return 0;
        }
        return prev + step;
      });
    }, INTERVAL_MS);

    return () => clearInterval(timer);
  }, [openUserId, activeStoryIndex, isPaused, currentStory?.id]);

  // Auto-open when a user id is targeted from outside the tray (avatar click,
  // profile, followers). Guards on the currently-open id so re-sorting caused by
  // marking stories seen never reinitialises the running story.
  useEffect(() => {
    if (!activeUserId || openUserId) return;
    if (groupedUsers.findIndex((g) => g.userId === activeUserId) === -1) return;
    openUser(activeUserId);
  }, [activeUserId, openUserId, groupedUsers]);

  const handleLike = async () => {
    if (!currentStory || !identity) return;
    playLike();

    // Spawn floating heart particles
    const newHeart = { id: Date.now() + Math.random(), x: Math.random() * 60 + 20 };
    setFloatingHearts((prev) => [...prev, newHeart]);
    setTimeout(() => {
      setFloatingHearts((prev) => prev.filter((h) => h.id !== newHeart.id));
    }, 1200);

    setLikedStories((prev) => new Set(prev).add(currentStory.id));

    try {
      const res = await orbitFetch(
        `/api/likes/${currentStory.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'like' }),
        },
        identity
      );
      if (res.ok) {
        toast('Story liked! +10 g$', 'success');
      }
    } catch {}
  };

  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return 'Just now';
    const seconds = Math.floor((now - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return `${Math.max(1, seconds)}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollStories = (dir: 'left' | 'right') => {
    playPress(700);
    if (scrollRef.current) {
      const scrollAmount = dir === 'left' ? -220 : 220;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <div className="w-full flex flex-col font-sans select-none relative group/tray">
      {/* Left Scroll Arrow */}
      <button
        type="button"
        onClick={() => scrollStories('left')}
        aria-label="Previous Stories"
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-surface-raised/90 shadow-md border border-border-glass text-retro-body hover:text-retro-fg flex items-center justify-center cursor-pointer transition-all opacity-0 group-hover/tray:opacity-100 disabled:opacity-0"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {/* Right Scroll Arrow */}
      <button
        type="button"
        onClick={() => scrollStories('right')}
        aria-label="Next Stories"
        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-surface-raised/90 shadow-md border border-border-glass text-retro-body hover:text-retro-fg flex items-center justify-center cursor-pointer transition-all opacity-0 group-hover/tray:opacity-100 disabled:opacity-0"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* Stories Horizontal Carousel */}
      <div
        ref={scrollRef}
        className="flex items-center gap-3.5 sm:gap-4 overflow-x-auto scrollbar-none py-1 px-1 scroll-smooth"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {/* Current User Story / Add Story Circle */}
        <div
          className="flex flex-col items-center gap-1 shrink-0 group cursor-pointer"
          onClick={onAddStory}
        >
          <div className="relative p-[2px] rounded-full">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-surface-interactive overflow-hidden flex items-center justify-center border border-border-glass">
              {profilePics[currentUserId] ? (
                <img src={resolveMediaUrl(profilePics[currentUserId])} alt="You" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-black text-retro-muted">YOU</span>
              )}
            </div>
            <div className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-[#0095f6] border-2 border-white flex items-center justify-center text-white shadow-xs">
              <Plus className="w-3 h-3 stroke-[3]" />
            </div>
          </div>
          <span className="text-xs font-medium text-retro-body truncate max-w-[64px]">Your story</span>
        </div>

        {/* Grouped User Story Circles */}
        {groupedUsers.map((group) => (
          <div
            key={group.userId}
            className="flex flex-col items-center gap-1 shrink-0 group cursor-pointer"
            onClick={() => {
              playPress(850);
              openUser(group.userId);
            }}
          >
            {/* Unseen story ring (design system: monochrome accent, not color gradient) */}
            <div
              className={`p-[2.5px] rounded-full transition-transform group-hover:scale-105 ${
                group.hasUnseen
                  ? 'bg-retro-accent'
                  : 'bg-glass-w20'
              }`}
            >
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-surface-raised p-[2px] overflow-hidden">
                <div className="w-full h-full rounded-full bg-surface-interactive overflow-hidden flex items-center justify-center">
                  {group.pfpUrl && !pfpFailed[group.userId] ? (
                    <img
                      src={resolveMediaUrl(group.pfpUrl)}
                      alt={group.displayName}
                      className="w-full h-full object-cover"
                      onError={() => setPfpFailed((prev) => (prev[group.userId] ? prev : { ...prev, [group.userId]: true }))}
                    />
                  ) : (
                    <span className="text-sm font-black text-retro-muted">
                      {group.displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <span className="text-xs font-medium text-retro-body truncate max-w-[64px]">
              {group.displayName}
            </span>
          </div>
        ))}
        {groupedUsers.length === 0 && !loading && (
          <div className="text-xs text-retro-muted py-2 italic px-2">
            No active stories yet.
          </div>
        )}
      </div>

      {/* ── 2. Fullscreen Instagram Story Viewer Lightbox ── */}
      {openUserId && activeGroup && currentStory && createPortal(
        <div
          className="fixed inset-0 z-[var(--z-system)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 animate-orbit-fade-in"
          onClick={closeStoryViewer}
          onMouseDown={() => setIsPaused(true)}
          onMouseUp={() => setIsPaused(false)}
          onTouchStart={() => setIsPaused(true)}
          onTouchEnd={() => setIsPaused(false)}
        >
{/* Main Story Canvas — full viewport, centered media, overlays float */}
          <div
            className="relative w-full h-full max-w-none bg-black border-0 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Segmented Progress Bars */}
            <div className="absolute top-3 left-3 right-3 z-30 flex items-center gap-1.5">
              {activeGroup.stories.map((s, sIdx) => {
                let fillPercent = 0;
                if (sIdx < activeStoryIndex) fillPercent = 100;
                else if (sIdx === activeStoryIndex) fillPercent = progress;

                // Instagram parity: white track, dimmer once the story was seen
                // in an earlier run; the running segment fills solid white.
                const wasSeen = seenStoryIds.has(s.id) && sIdx !== activeStoryIndex;

                return (
                  <div
                    key={s.id || sIdx}
                    data-testid={`seg-track-${sIdx}`}
                    className={`flex-1 h-1 rounded-full overflow-hidden backdrop-blur-xs ${wasSeen ? 'bg-white/25' : 'bg-white/40'}`}
                  >
                    <div
                      data-testid={`seg-fill-${sIdx}`}
                      className="h-full bg-retro-accent transition-all duration-150"
                      style={{ width: `${fillPercent}%` }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Top Header Bar: Avatar, Name, Time Ago, and Close */}
            <div className="absolute top-6 left-3 right-3 z-30 flex items-center justify-between text-white drop-shadow-md">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full p-[1.5px] bg-retro-accent">
                  <div className="w-full h-full rounded-full bg-surface-canvas overflow-hidden flex items-center justify-center">
                    {activeGroup.pfpUrl && !pfpFailed[activeGroup.userId] ? (
                      <img
                        src={resolveMediaUrl(activeGroup.pfpUrl)}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={() => setPfpFailed((prev) => (prev[activeGroup.userId] ? prev : { ...prev, [activeGroup.userId]: true }))}
                      />
                    ) : (
                      <span className="text-[10px] font-bold">{activeGroup.displayName.substring(0, 1)}</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold leading-tight">{activeGroup.displayName}</div>
                  <div className="text-[10px] text-retro-body font-medium">{formatTimeAgo(currentStory.created_at)}</div>
                  {/* The view count is the author's receipt: only their own story carries one. */}
                  {currentStory.owner_id === currentUserId && typeof currentStory.view_count === 'number' && (
                    <div className="text-[10px] text-retro-body font-medium">
                      {currentStory.view_count} {currentStory.view_count === 1 ? 'view' : 'views'}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeStoryViewer}
                  className="w-8 h-8 rounded-full bg-black/40 hover:bg-black/70 border border-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
                  aria-label="Close Story"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Navigation Click Tap Zones (Left 35% = Prev, Right 65% = Next) */}
            <div className="absolute inset-0 z-10 flex">
              <div
                className="w-1/3 h-full cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  playPress(700);
                  goToPrevStory();
                }}
              />
              <div
                className="w-2/3 h-full cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  playPress(800);
                  goToNextStory();
                }}
              />
            </div>

            {/* Center Media Presentation — fills canvas, image letterboxed dead-center */}
            <div className="absolute inset-0 z-0 flex items-center justify-center bg-black overflow-hidden">
              {identity && (!currentStory.content_url || (currentStory.content_url || '').includes('/api/objects/')) ? (
                <ObjectImage
                  objectId={currentStory.id}
                  contentUrl={currentStory.content_url}
                  identity={identity}
                  hideUnavailable
                  className="w-full h-full object-contain"
                  videoClassName="w-full h-full object-contain"
                />
              ) : isMediaVideo(currentStory.mime_type || '') ? (
                <LazyVideo
                  src={currentStory.content_url || ''}
                  className="w-full h-full"
                  videoClassName="w-full h-full object-contain"
                  autoPlay
                  loop
                  playsInline
                />
              ) : currentStory.content_url ? (
                <ObjectImage
                  contentUrl={currentStory.content_url}
                  objectId={currentStory.id}
                  identity={identity ?? null}
                  mimeType={currentStory.mime_type}
                  hideUnavailable
                  alt="Story content"
                  className="w-full h-full object-contain select-none"
                />
              ) : (
                <ObjectImage
                  objectId={currentStory.id}
                  contentUrl={currentStory.content_url}
                  identity={identity || null}
                  hideUnavailable
                  className="w-full h-full object-contain"
                />
              )}

              {/* Floating Animated Hearts */}
              {floatingHearts.map((heart) => (
                <div
                  key={heart.id}
                  className="absolute bottom-20 z-40 pointer-events-none animate-orbit-pop"
                  style={{ left: `${heart.x}%` }}
                >
                  <Heart className="w-12 h-12 text-amber-400 fill-rose-500 drop-shadow-2xl animate-bounce" />
                </div>
              ))}
            </div>

            {/* Bottom Floating Caption Pill */}
            {currentStory.caption && (
              <div className="absolute bottom-20 left-4 right-4 z-20">
                <div className="p-3 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl text-xs text-white leading-relaxed">
                  {currentStory.caption}
                </div>
              </div>
            )}

{/* Only Like and DM actions */}
            <div className="absolute bottom-0 left-0 right-0 z-30 p-4 bg-gradient-to-t from-black via-black/80 to-transparent flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleLike}
                  className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all cursor-pointer active:scale-80 shadow-md ${
                    likedStories.has(currentStory.id)
                      ? 'bg-cyan-500 border-cyan-500 text-white'
                      : 'bg-surface-raised/10 hover:bg-surface-raised/20 border-border-strong text-white'
                  }`}
                  aria-label="Like story"
                >
                  <Heart
                    className={`w-5 h-5 ${likedStories.has(currentStory.id) ? 'fill-white text-white' : 'text-white'}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playPress(880);
                    if (onStartPm) onStartPm({ id: activeGroup.userId, display_name: activeGroup.displayName });
                  }}
                  className="h-10 px-5 rounded-full bg-surface-raised/10 hover:bg-surface-raised/20 border border-border-strong flex items-center justify-center gap-2 text-white transition-all cursor-pointer active:scale-95 shadow-md"
                  aria-label={`Message ${activeGroup.displayName}`}
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="text-xs font-bold">Message</span>
</button>
              </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
