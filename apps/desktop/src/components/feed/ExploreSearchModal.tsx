"use client";

import { useState, useMemo } from 'react';
import { playPress } from '../../utils/sounds';
import { Search, X, MessageCircle, Users, Image as ImageIcon, Hash, Play, Video } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { FeedPost } from './GMatchFeed';
import { ObjectImage } from '../ObjectImage';
import { isMediaVideo, resolveMediaUrl } from '../../utils/media';

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
      className="fixed inset-0 z-[var(--z-system)] bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-0 sm:p-4 font-sans select-none animate-orbit-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised w-full sm:max-w-lg h-full sm:h-[80vh] max-h-[80vh] rounded-none sm:rounded-xl border border-border-glass shadow-2xl overflow-hidden flex flex-col text-retro-fg animate-orbit-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between bg-surface-raised shrink-0">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-retro-fg" />
            <h3 className="text-sm font-black tracking-tight">Explore gMatch</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-retro-muted hover:text-retro-fg hover:bg-glass-w10 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-3 border-b border-border-glass bg-surface-interactive shrink-0">
          <div className="flex items-center gap-2 bg-surface-raised border border-border-glass rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-cyan-500/30">
            <Search className="w-4 h-4 text-retro-muted shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="Search people, captions, tags..."
              className="w-full bg-transparent focus:outline-none text-xs placeholder:text-retro-muted"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-retro-muted hover:text-retro-fg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-3 space-y-5 styled-scrollbar">
          {/* Users */}
          {matchedUsers.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-retro-muted px-1">
                People
              </span>
              {matchedUsers.map((u) => {
                const id = u.id || u.orbitId || '';
                const isSelf = identity && id === identity.orbitId;
                const pfp = pfpFor(u);
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between p-2 rounded-xl hover:bg-glass-w5 transition-colors group"
                  >
                    <div
                      className="flex items-center gap-3 cursor-pointer min-w-0 flex-1"
                      onClick={() => {
                        playPress(750);
                        onSelectUser?.(id);
                        onClose();
                      }}
                    >
                      <div className="w-10 h-10 rounded-full bg-glass-w20 overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold">
                        {pfp ? (
                          <img src={resolveMediaUrl(pfp)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          (u.display_name || id).charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-retro-fg block truncate">
                           {u.display_name?.trim() || 'Unknown User'}
                        </span>
                        <span className="text-[10px] text-retro-muted block font-mono truncate">
                          {id.slice(0, 14)}...
                        </span>
                      </div>
                    </div>
                    {!isSelf && onStartPm && (
                      <button
                        type="button"
                        onClick={() => {
                          playPress(800);
                          onStartPm({ id, display_name: u.display_name });
                          onClose();
                        }}
                        className="p-2 text-retro-muted hover:text-retro-fg rounded-xl hover:bg-glass-w10 transition-colors cursor-pointer shrink-0"
                        title="Message"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Posts */}
          {matchedPosts.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-retro-muted px-1">
                Posts
              </span>
              {matchedPosts.slice(0, 8).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 p-2 rounded-xl hover:bg-glass-w5 transition-colors cursor-pointer"
                  onClick={() => {
                    playPress(700);
                    onOpenPost?.(p);
                    onClose();
                  }}
                >
                  <div className="w-10 h-10 rounded-xl bg-glass-w20 overflow-hidden shrink-0 flex items-center justify-center relative">
                    {p.url ? (
                      <>
                        <ObjectImage contentUrl={p.url} identity={identity} alt="" className="w-full h-full object-cover" />
                        {isMediaVideo(p.url) && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white pointer-events-none">
                            <Play className="w-3.5 h-3.5 fill-white" />
                          </div>
                        )}
                      </>
                    ) : (
                      <ImageIcon className="w-4 h-4 text-retro-muted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-retro-fg block truncate">{p.author_name}</span>
                      {isMediaVideo(p.url) && (
                        <span className="px-1 py-0.2 rounded bg-black/60 border border-white/10 text-[10px] font-mono text-retro-accent uppercase tracking-wider">
                          Video
                        </span>
                      )}
                    </div>
                    {p.caption && <p className="text-xs text-retro-muted truncate">{p.caption}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tags */}
          {matchedTags.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-retro-muted px-1">
                Tags
              </span>
              <div className="flex flex-wrap gap-1.5 px-1">
                {matchedTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      playPress(650);
                      setQuery('#' + t);
                      toast?.(`Showing posts tagged #${t}`, 'info');
                    }}
                    className="px-2.5 py-1 rounded-full bg-surface-interactive hover:bg-glass-w12 text-xs font-bold text-retro-body flex items-center gap-1 cursor-pointer transition-colors border border-border-glass"
                  >
                    <Hash className="w-3 h-3 text-retro-muted" />
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {q && matchedUsers.length === 0 && matchedPosts.length === 0 && matchedTags.length === 0 && (
            <div className="py-14 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-surface-interactive flex items-center justify-center mx-auto text-retro-muted">
                <Users className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-retro-fg">No results for &ldquo;{query}&rdquo;</p>
              <p className="text-xs text-retro-muted">Try searching a different name, caption or tag.</p>
            </div>
          )}

          {/* Prompt */}
          {!q && (
            <div className="py-14 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-surface-interactive flex items-center justify-center mx-auto text-retro-muted">
                <Search className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-retro-fg">Discover the network</p>
              <p className="text-xs text-retro-muted max-w-xs mx-auto">
                Search players, posts and tags across gMatch to find your next match, card or obsession.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
