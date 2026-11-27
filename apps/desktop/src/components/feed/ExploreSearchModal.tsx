"use client";

import { useState, useMemo } from 'react';
import { playPress } from '../../utils/sounds';
import { Search, X, MessageCircle, Users, Image as ImageIcon, Hash, Play } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { FeedPost } from './GMatchFeed';
import { ObjectImage } from '../ObjectImage';
import { isMediaVideo, resolveMediaUrl } from '../../utils/media';
import { Button, Input } from '../../ui/kit';
import {
  classes, CHROME, COLOR, FEEDBACK, GAP, ICON, MONO, MOTION, PADDING, PADDING_X, PADDING_Y,
  RADIUS, RECIPE, TRACKING, TYPE, WEIGHT,
} from '../../ui/tokens';

interface PeerUser {
  id: string;
  display_name?: string;
  orbitId?: string;
  pfp_url?: string | null;
}

export function ExploreSearchModal({
  isOpen,
  onClose,
  identity,
  users = [],
  posts = [],
  profilePics = {},
  onSelectUser,
  onOpenPost,
  onStartPm,
  toast,
}: {
  isOpen: boolean;
  onClose: () => void;
  identity: OrbitIdentity | null;
  users?: PeerUser[];
  posts?: FeedPost[];
  profilePics?: Record<string, string>;
  onSelectUser?: (userId: string) => void;
  onOpenPost?: (post: FeedPost) => void;
  onStartPm?: (user: { id: string; display_name?: string }) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();

  const matchedUsers = useMemo(() => {
    if (!q) return users.slice(0, 6);
    return users.filter((u) => {
      const name = (u.display_name || '').toLowerCase();
      const id = (u.id || u.orbitId || '').toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [users, q]);

  const matchedPosts = useMemo(() => {
    if (!q) return [];
    const cleanQ = q.replace(/^#/, '');
    return posts.filter((p) => {
      const caption = (p.caption || '').toLowerCase();
      const tags = (p.tags || []).map((t) => t.replace(/^#/, '').toLowerCase());
      return caption.includes(q) || tags.includes(cleanQ);
    });
  }, [posts, q]);

  const matchedTags = useMemo(() => {
    if (!q) return [];
    const cleanQ = q.replace(/^#/, '');
    if (!cleanQ) return [];
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const p of posts) {
      for (const t of p.tags || []) {
        const clean = t.replace(/^#/, '');
        if (!seen.has(clean) && clean.toLowerCase().includes(cleanQ.toLowerCase())) {
          seen.add(clean);
          tags.push(clean);
        }
      }
    }
    return tags.slice(0, 8);
  }, [posts, q]);

  if (!isOpen) return null;

  const pfpFor = (u: PeerUser) => profilePics[u.id] || profilePics[u.orbitId || ''] || u.pfp_url || '';

  return (
    <div
      className={classes(RECIPE.modalOverlay, 'items-start sm:items-center font-sans select-none')}
      onClick={onClose}
    >
      <div
        className={classes(CHROME.overlayPanel, 'w-full sm:max-w-lg h-full sm:h-[80vh] max-h-(--max-h-panel) overflow-hidden flex flex-col', COLOR.fg, MOTION.keyframe.pop)}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={classes(RECIPE.cardHeader, COLOR.surfaceRaised, 'shrink-0')}>
          <div className={classes('flex items-center', GAP[2])}>
            <Search className={classes(ICON.lg, COLOR.fg)} />
            <h3 className={classes(TYPE.base, WEIGHT.heading, TRACKING.tight)}>Explore gMatch</h3>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close search" className={classes(RADIUS.pill, PADDING[1.5])}>
            <X className={ICON.md} />
          </Button>
        </div>

        {/* Search Input */}
        <div className={classes(PADDING[3], 'border-b', COLOR.edge, COLOR.interactive, 'shrink-0')}>
          <div className={classes('flex items-center', GAP[2], COLOR.surfaceRaised, 'border', COLOR.edge, RADIUS.panel, PADDING_X[3], PADDING_Y[2], 'focus-within:ring-2 focus-within:ring-info/30')}>
            <Search className={classes(ICON.md, COLOR.muted, 'shrink-0')} />
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              bare
              placeholder="Search people, captions, tags..."
            />
            {query && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setQuery('')} className={PADDING[1]} aria-label="Clear search">
                <X className={ICON.md} />
              </Button>
            )}
          </div>
        </div>

        {/* Results */}
        <div className={classes('flex-1 overflow-y-auto', PADDING[3], 'space-y-5 styled-scrollbar')}>
          {/* Users */}
          {matchedUsers.length > 0 && (
            <div className={classes('space-y-1', TRACKING.tight)}>
              <span className={classes(TYPE.caption, WEIGHT.heading, 'uppercase', TRACKING.wider, COLOR.muted, PADDING_X[1])}>People</span>
              {matchedUsers.map((u) => {
                const id = u.id || u.orbitId || '';
                const isSelf = identity && id === identity.orbitId;
                const pfp = pfpFor(u);
                return (
                  <div
                    key={id}
                    className={classes('flex items-center justify-between', PADDING[2], RADIUS.panel, COLOR.hoverW5, MOTION.transition.micro, 'group')}
                  >
                    <button
                      type="button"
                      className={classes('flex items-center', GAP[3], 'cursor-pointer min-w-0 flex-1')}
                      onClick={() => {
                        playPress(750);
                        onSelectUser?.(id);
                        onClose();
                      }}
                    >
                      <div className={classes('w-10 h-10', RADIUS.pill, COLOR.glassW20, 'overflow-hidden shrink-0 flex items-center justify-center', TYPE.body, WEIGHT.bold)}>
                        {pfp ? (
                          <img src={resolveMediaUrl(pfp)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          (u.display_name || id).charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className={classes(TYPE.body, WEIGHT.bold, COLOR.fg, 'block truncate')}>
                           {u.display_name?.trim() || 'Unknown User'}
                        </span>
                        <span className={classes(TYPE.caption, COLOR.muted, 'block font-mono truncate')}>
                          {id.slice(0, 14)}...
                        </span>
                      </div>
                    </button>
                    {!isSelf && onStartPm && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          playPress(800);
                          onStartPm({ id, display_name: u.display_name });
                          onClose();
                        }}
                        className={PADDING[2]}
                        title="Message"
                      >
                        <MessageCircle className={ICON.md} />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Posts */}
          {matchedPosts.length > 0 && (
            <div className={classes('space-y-1', TRACKING.tight)}>
              <span className={classes(TYPE.caption, WEIGHT.heading, 'uppercase', TRACKING.wider, COLOR.muted, PADDING_X[1])}>Posts</span>
              {matchedPosts.slice(0, 8).map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={classes('flex items-center', GAP[3], PADDING[2], RADIUS.panel, COLOR.hoverW5, MOTION.transition.micro, 'cursor-pointer')}
                  onClick={() => {
                    playPress(700);
                    onOpenPost?.(p);
                    onClose();
                  }}
                >
                  <div className={classes('w-10 h-10', RADIUS.panel, COLOR.glassW20, 'overflow-hidden shrink-0 flex items-center justify-center relative')}>
                    {p.url ? (
                      <>
                        <ObjectImage contentUrl={p.url} identity={identity} alt="" className="w-full h-full object-cover" thumb />
                        {isMediaVideo(p.url) && (
                          <div className={classes('absolute inset-0', COLOR.mediaVeil, 'flex items-center justify-center', COLOR.fg, 'pointer-events-none')}>
                            <Play className={classes(ICON.sm, COLOR.onMediaFill)} />
                          </div>
                        )}
                      </>
                    ) : (
                      <ImageIcon className={classes(ICON.md, COLOR.muted)} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={classes('flex items-center', GAP[1.5])}>
                      <span className={classes(TYPE.body, WEIGHT.bold, COLOR.fg, 'block truncate')}>{p.author_name}</span>
                      {isMediaVideo(p.url) && (
                        <span className={classes(PADDING_X[1], 'py-0.2', RADIUS.chip, COLOR.scrim, 'border', COLOR.edge, TYPE.caption, MONO, COLOR.accent, 'uppercase', TRACKING.wider)}>
                          Video
                        </span>
                      )}
                    </div>
                    {p.caption && <p className={classes(FEEDBACK.description, 'truncate')}>{p.caption}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Tags */}
          {matchedTags.length > 0 && (
            <div className={classes('space-y-1.5', TRACKING.tight)}>
              <span className={classes(TYPE.caption, WEIGHT.heading, 'uppercase', TRACKING.wider, COLOR.muted, PADDING_X[1])}>Tags</span>
              <div className={classes('flex flex-wrap', GAP[1.5], PADDING_X[1])}>
                {matchedTags.map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      playPress(650);
                      setQuery('#' + t);
                      toast?.(`Showing posts tagged #${t}`, 'info');
                    }}
                    className={classes(RADIUS.pill, TYPE.body, WEIGHT.bold, COLOR.body, 'flex items-center', GAP[1])}
                  >
                    <Hash className={classes(ICON.sm, COLOR.muted)} />
                    {t}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {q && matchedUsers.length === 0 && matchedPosts.length === 0 && matchedTags.length === 0 && (
            <div className={classes(FEEDBACK.center)}>
              <div className={classes('w-12 h-12', RADIUS.pill, COLOR.interactive, 'flex items-center justify-center mx-auto', COLOR.muted)}>
                <Users className={ICON.lg} />
              </div>
              <div>
                <p className={classes(TYPE.sub, WEIGHT.bold, COLOR.fg)}>No results for &ldquo;{query}&rdquo;</p>
                <p className={FEEDBACK.description}>Try searching a different name, caption or tag.</p>
              </div>
            </div>
          )}

          {/* Prompt */}
          {!q && (
            <div className={classes(FEEDBACK.center)}>
              <div className={classes('w-12 h-12', RADIUS.pill, COLOR.interactive, 'flex items-center justify-center mx-auto', COLOR.muted)}>
                <Search className={ICON.lg} />
              </div>
              <div>
                <p className={classes(TYPE.sub, WEIGHT.bold, COLOR.fg)}>Discover the network</p>
                <p className={classes(FEEDBACK.description, 'max-w-xs mx-auto')}>
                  Search players, posts and tags across gMatch to find your next match, card or obsession.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
