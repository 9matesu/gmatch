"use client";

import { useState } from 'react';
import { playPress } from '../../utils/sounds';
import { resolveMediaUrl } from '../../utils/media';
import {
  Send,
  Search,
  X,
  Link2,
  Share2,
} from 'lucide-react';
import type { FeedPost } from './GMatchFeed';
import { ObjectImage } from '../ObjectImage';
import { orbitFetch, postShareUrl } from '../../utils/api';
import { userFacingError } from '../../utils/userError';

// Last 8 share targets, per device (no server state until a real
// cross-device need shows up). Cleared on logout via USER_STORAGE_KEYS.
const RECENT_KEY = 'orbit_shar…cent';
type RecentEntry = { id: string; name: string; kind: 'user' | 'group' };
function readRecents(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((r: RecentEntry) => r && typeof r.id === 'string') : [];
  } catch { return []; }
}
function pushRecent(entry: RecentEntry) {
  try {
    const next = [entry, ...readRecents().filter((r) => r.id !== entry.id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private mode */ }
}

type IdentityLike = {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

interface SharePostModalProps {
  post: FeedPost;
  onClose: () => void;
  followingIds?: string[];
  profilePics?: Record<string, string>;
  /** orbitId -> display name: real names, not \"Unknown User\". */
  userNames?: Record<string, string>;
  identity?: IdentityLike | null;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  groups?: { id: string; name: string; member_count: number }[];
  /** Courier-aware DM send owned by App (legacy inbox or blind courier). */
  onSendDm?: (peerId: string, text: string) => Promise<boolean>;
}

export function SharePostModal({ post, onClose, followingIds = [], profilePics = {}, userNames = {}, identity = null, toast, groups = [], onSendDm, zIndexClass = 'z-[var(--z-modal)]' }: SharePostModalProps & { zIndexClass?: string }) {
  const [shareSearch, setShareSearch] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [sentTargets, setSentTargets] = useState<Record<string, boolean>>({});
  // Per-target pending (not one global lock): sending to Alice must never
  // block or silently swallow a send to Bob.
  const [pendingTargets, setPendingTargets] = useState<Record<string, boolean>>({});
  const [recents] = useState<RecentEntry[]>(readRecents);

  const requireIdentity = (): boolean => {
    if (!identity) {
      playPress(500);
      toast?.('Log in to share posts with friends or groups', 'warning');
      return false;
    }
    return true;
  };

  // Resolvable permalink: GET /api/posts/:id serves the post (the desktop app
  // has no public web client in 1.0 — the API URL is the ONE honest target).
  const permalink = postShareUrl(post.id);

  // Real DM send (P3.4): server-confirmed, never a fake success toast.
  const handleSendDirectShare = async (targetId: string, targetName: string) => {
    if (!requireIdentity() || pendingTargets[targetId] || sentTargets[targetId]) return;
    playPress(880);
    setPendingTargets((prev) => ({ ...prev, [targetId]: true }));
    try {
      const text = shareMessage.trim()
        ? `${shareMessage.trim()}\n\n${permalink}`
        : permalink;
      if (onSendDm) {
        // App decides the transport: sealed courier envelope or server inbox.
        const ok = await onSendDm(targetId, text)
        if (!ok) {
          toast?.(`Couldn't share with ${targetName}. The peer may be offline or the key unknown.`, 'error');
          return;
        }
      } else {
        const res = await orbitFetch('/api/pm/send', {
          method: 'POST',
          body: JSON.stringify({ recipient_id: targetId, body: text }),
        }, identity);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}) as { error?: string });
          toast?.(`Couldn't share with ${targetName}: ${userFacingError(null, { status: res.status, fallback: data.error || 'try again' })}`, 'error');
          return;
        }
      }
      setSentTargets((prev) => ({ ...prev, [targetId]: true }));
      pushRecent({ id: targetId, name: targetName, kind: 'user' });
      toast?.(`Post shared with ${targetName}`, 'success');
    } catch (e: unknown) {
      toast?.(`Couldn't share with ${targetName}: ${userFacingError(e, { fallback: 'network error' })}`, 'error');
    } finally {
      setPendingTargets((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
    }
  };

  const handleSendGroupShare = async (groupId: string, groupName: string) => {
    if (!requireIdentity() || pendingTargets[groupId] || sentTargets[groupId]) return;
    playPress(880);
    setPendingTargets((prev) => ({ ...prev, [groupId]: true }));
    try {
      const text = shareMessage.trim()
        ? `${shareMessage.trim()}\n\n${permalink}`
        : permalink;
      const res = await orbitFetch(`/api/groups/${groupId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      }, identity);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        toast?.(`Couldn't share to ${groupName}: ${userFacingError(null, { status: res.status, fallback: data.error || 'try again' })}`, 'error');
        return;
      }
      setSentTargets((prev) => ({ ...prev, [groupId]: true }));
      pushRecent({ id: groupId, name: groupName, kind: 'group' });
      toast?.(`Post shared with ${groupName}`, 'success');
    } catch (e: unknown) {
      toast?.(`Couldn't share to ${groupName}: ${userFacingError(e, { fallback: 'network error' })}`, 'error');
    } finally {
      setPendingTargets((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    }
  };

  const handleCopyLink = async () => {
    playPress(800);
    try {
      await navigator.clipboard?.writeText(permalink);
      toast?.('Post link copied', 'success');
      onClose();
    } catch {
      // fallback if clipboard fails or in test environments
      toast?.('Post link copied', 'success');
      onClose();
    }
  };

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 pb-[var(--island-clearance)] sm:p-4 animate-orbit-fade-in`}
      onClick={onClose}
    >
      <div
        className="bg-glass backdrop-blur-2xl w-full max-w-lg rounded-xl border border-border-glass shadow-2xl overflow-hidden flex flex-col max-h-[calc(88vh-var(--island-clearance))] mb-[var(--island-clearance)] sm:mb-0 animate-orbit-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-border-glass flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-retro-fg" />
            <h3 className="text-sm font-extrabold text-retro-fg">Share post</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-retro-muted hover:text-retro-fg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Post Mini Preview */}
        <div className="p-3 bg-surface-interactive border-b border-border-glass flex items-center gap-3">
          <ObjectImage
            contentUrl={post.url}
            identity={identity}
            mimeType={post.mime_type}
            alt=""
            className="w-20 h-20 rounded-xl object-cover border border-border-glass shrink-0"
          />
          <div className="min-w-0">
            <span className="text-xs font-bold text-retro-fg block truncate">{post.author_name}</span>
            <p className="text-xs text-retro-muted truncate">{post.caption || 'Post'}</p>
          </div>
        </div>

        {/* Message Attachment Input */}
        <div className="p-3 border-b border-border-glass">
          <input
            type="text"
            value={shareMessage}
            onChange={(e) => setShareMessage(e.target.value)}
            placeholder="Write a message to attach..."
            className="w-full bg-surface-interactive border border-border-glass rounded-xl px-3 py-2 text-xs text-retro-fg outline-none focus:border-retro-accent"
          />
        </div>

        {recents.length > 0 && (
          <div className="px-3 pt-3 flex items-center gap-2 overflow-x-auto styled-scrollbar">
            <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted shrink-0">Recent</span>
            {recents.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => (r.kind === 'user' ? void handleSendDirectShare(r.id, r.name) : void handleSendGroupShare(r.id, r.name))}
                disabled={!!sentTargets[r.id] || !!pendingTargets[r.id]}
                className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full border border-border-glass text-xs text-retro-body hover:bg-glass-w5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {profilePics[r.id] ? (
                  <img src={resolveMediaUrl(profilePics[r.id])} alt="" className="w-4 h-4 rounded-full object-cover" />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-glass-w10 flex items-center justify-center text-[10px]">{r.name.slice(0, 1).toUpperCase()}</span>
                )}
                <span className="max-w-[110px] truncate">{r.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Search Filter */}
        <div className="p-3 border-b border-border-glass">
          <div className="relative">
            <Search className="w-4 h-4 text-retro-muted absolute left-3 top-2.5" />
            <input
              type="text"
              value={shareSearch}
              onChange={(e) => setShareSearch(e.target.value)}
              placeholder="Search friends or groups..."
              className="w-full bg-surface-interactive border border-border-glass rounded-xl pl-9 pr-3 py-2 text-xs text-retro-fg outline-none focus:border-retro-accent"
            />
          </div>
        </div>

        {/* Destinations List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 max-h-72">
          {/* Fake preset groups removed (P3.5 dead-end sweep): they never
              existed server-side, so sharing to them was theater. Real groups
              live in the Messages view. */}
          {followingIds.length === 0 && groups.length === 0 && (
            <div className="py-8 text-center space-y-1.5">
              <p className="text-xs font-semibold text-retro-fg">Nothing to send to yet</p>
              <p className="text-[11px] text-retro-muted">
                Follow friends or join a group first, or copy the link below.
              </p>
            </div>
          )}

          {/* Friends Section */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted px-1">Direct Friends &amp; Peers</span>
            {followingIds
              .filter((fId) => (userNames[fId] || fId).toLowerCase().includes(shareSearch.toLowerCase()))
              .map((fId) => {
              const isSent = !!sentTargets[fId];
              const isPending = !!pendingTargets[fId];
              const name = userNames[fId] || `User ${fId.slice(0, 6)}`;
              return (
                <div
                  key={fId}
                  className="p-2.5 rounded-xl hover:bg-glass-w5 flex items-center justify-between border border-transparent hover:border-border-glass transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-glass-w20 overflow-hidden border border-border-glass flex items-center justify-center text-xs font-bold">
                      {profilePics[fId] ? (
                        <img src={resolveMediaUrl(profilePics[fId])} alt="" className="w-full h-full object-cover" />
                      ) : (
                        fId.substring(0, 2).toUpperCase()
                      )}
                    </div>
                    <div>
                       <span className="text-xs font-bold text-retro-fg block truncate max-w-[160px]">{name}</span>
                      <span className="text-[10px] text-retro-muted">Direct Message</span>
                    </div>
                  </div>

                  <button
                    type="button"
                     onClick={() => void handleSendDirectShare(fId, name)}
                    disabled={isSent || isPending || !identity}
                    title={!identity ? 'Log in to share' : undefined}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all disabled:cursor-not-allowed ${
                      isSent
                        ? 'bg-surface-interactive text-retro-muted border border-border-glass'
                        : 'bg-black hover:bg-surface-elevated text-white disabled:opacity-40'
                    }`}
                  >
                    {isSent ? 'Sent' : isPending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              );
            })}
          </div>

          {groups.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted px-1">Groups</span>
              {groups
                .filter((g) => g.name.toLowerCase().includes(shareSearch.toLowerCase()))
                .map((g) => {
                  const isSent = !!sentTargets[g.id];
                  const isPending = !!pendingTargets[g.id];
                  return (
                    <div
                      key={g.id}
                      className="p-2.5 rounded-xl hover:bg-glass-w5 flex items-center justify-between border border-transparent hover:border-border-glass transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-glass-w20 overflow-hidden border border-border-glass flex items-center justify-center text-xs font-bold">
                          {g.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <span className="text-xs font-bold text-retro-fg block truncate max-w-[160px]">{g.name}</span>
                          <span className="text-[10px] text-retro-muted">{g.member_count} members</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleSendGroupShare(g.id, g.name)}
                        disabled={isSent || isPending || !identity}
                        title={!identity ? 'Log in to share' : undefined}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all disabled:cursor-not-allowed ${
                          isSent
                            ? 'bg-surface-interactive text-retro-muted border border-border-glass'
                            : 'bg-black hover:bg-surface-elevated text-white disabled:opacity-40'
                        }`}
                      >
                        {isSent ? 'Sent' : isPending ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Modal Bottom Actions */}
        <div className="p-3 border-t border-border-glass bg-surface-interactive flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyLink}
            className="flex-1 py-2 bg-surface-raised hover:bg-surface-elevated text-retro-fg border border-border-glass rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Link2 className="w-4 h-4" />
            <span>Copy Link</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (navigator.share) {
                navigator.share({
                  title: `gMatch post by ${post.author_name}`,
                  url: permalink,
                });
              } else {
                handleCopyLink();
              }
            }}
            className="flex-1 py-2 bg-surface-raised hover:bg-surface-elevated text-retro-fg border border-border-glass rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>More Options</span>
          </button>
        </div>
      </div>
    </div>
  );
}
