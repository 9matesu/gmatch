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
import { copyText } from '../../utils/clipboard';
import { Button, Input } from '../../ui/kit';
import {
  classes, CHROME, COLOR, FEEDBACK, GAP, ICON, MOTION, PADDING, PADDING_X,
  RADIUS, RECIPE, TRACKING, TYPE, WEIGHT,
} from '../../ui/tokens';

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
    // Report the real outcome: the old code toasted "copied" in BOTH branches,
    // so a failed copy looked identical to a successful one.
    const ok = await copyText(permalink);
    toast?.(ok ? 'Post link copied' : 'Could not copy the link', ok ? 'success' : 'error');
    if (ok) onClose();
  };

  return (
    <div
      className={classes(RECIPE.modalOverlay, zIndexClass, 'items-end sm:items-center', 'p-0 pb-[var(--island-clearance)] sm:p-4')}
    >
      <div
        className={classes(CHROME.overlayPanel, 'w-full max-w-lg overflow-hidden flex flex-col max-h-[calc(88vh-var(--island-clearance))] mb-[var(--island-clearance)] sm:mb-0', MOTION.keyframe.slideUp)}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className={classes(PADDING[4], 'border-b', COLOR.edge, 'flex items-center justify-between')}>
          <div className={classes('flex items-center', GAP[2])}>
            <Send className={classes(ICON.lg, COLOR.fg)} />
            <h3 className={classes(TYPE.body, WEIGHT.heading, COLOR.fg)}>Share post</h3>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close share dialog"
            className={classes(RADIUS.pill, PADDING[1])}
          >
            <X className={ICON.md} />
          </Button>
        </div>

        {/* Post Mini Preview */}
        <div className={classes(PADDING[3], COLOR.interactive, 'border-b', COLOR.edge, 'flex items-center', GAP[3])}>
          <ObjectImage
            contentUrl={post.url}
            identity={identity}
            mimeType={post.mime_type}
            alt=""
            className={classes('w-20 h-20 object-cover border', COLOR.edge, RADIUS.panel, 'shrink-0')}
          />
          <div className="min-w-0">
            <span className={classes(TYPE.body, WEIGHT.bold, COLOR.fg, 'block truncate')}>{post.author_name}</span>
            <p className={classes(FEEDBACK.description, 'truncate')}>{post.caption || 'Post'}</p>
          </div>
        </div>

        {/* Message Attachment Input */}
        <div className={classes(PADDING[3], 'border-b', COLOR.edge)}>
          <Input
            type="text"
            value={shareMessage}
            onChange={(e) => setShareMessage(e.target.value)}
            placeholder="Write a message to attach..."
          />
        </div>

        {recents.length > 0 && (
          <div className={classes(PADDING_X[3], 'pt-3 flex items-center', GAP[2], 'overflow-x-auto styled-scrollbar')}>
            <span className={classes(TYPE.caption, WEIGHT.bold, 'uppercase', TRACKING.wider, COLOR.muted, 'shrink-0')}>Recent</span>
            {recents.map((r) => (
              <Button
                key={r.id}
                type="button"
                variant="secondary"
                onClick={() => (r.kind === 'user' ? void handleSendDirectShare(r.id, r.name) : void handleSendGroupShare(r.id, r.name))}
                disabled={!!sentTargets[r.id] || !!pendingTargets[r.id]}
                className={classes(RADIUS.pill, 'shrink-0', TYPE.body, COLOR.body)}
              >
                {profilePics[r.id] ? (
                  <img src={resolveMediaUrl(profilePics[r.id])} alt="" className={classes('w-4 h-4', RADIUS.pill, 'object-cover')} />
                ) : (
                  <span className={classes('w-4 h-4', RADIUS.pill, COLOR.glassW8, 'flex items-center justify-center', TYPE.caption)}>{r.name.slice(0, 1).toUpperCase()}</span>
                )}
                <span className="max-w-[110px] truncate">{r.name}</span>
              </Button>
            ))}
          </div>
        )}

        {/* Search Filter */}
        <div className={classes(PADDING[3], 'border-b', COLOR.edge)}>
          <div className="relative">
            <Search className={classes(ICON.md, COLOR.muted, 'absolute left-3 top-2.5')} />
            <Input
              type="text"
              value={shareSearch}
              onChange={(e) => setShareSearch(e.target.value)}
              placeholder="Search friends or groups..."
              className="pl-9"
            />
          </div>
        </div>

        {/* Destinations List */}
        <div className={classes('flex-1 overflow-y-auto', PADDING[3], 'space-y-4 max-h-72')}>
          {/* Fake preset groups removed (P3.5 dead-end sweep): they never
              existed server-side, so sharing to them was theater. Real groups
              live in the Messages view. */}
          {followingIds.length === 0 && groups.length === 0 && (
            <div className={classes(FEEDBACK.centerCompact)}>
              <p className={classes(FEEDBACK.title)}>Nothing to send to yet</p>
              <p className={classes(FEEDBACK.description)}>
                Follow friends or join a group first, or copy the link below.
              </p>
            </div>
          )}

          {/* Friends Section */}
          <div className={classes('space-y-1.5')}>
            <span className={classes(TYPE.caption, WEIGHT.bold, 'uppercase', TRACKING.wider, COLOR.muted, PADDING_X[1])}>Direct Friends &amp; Peers</span>
            {followingIds
              .filter((fId) => (userNames[fId] || fId).toLowerCase().includes(shareSearch.toLowerCase()))
              .map((fId) => {
              const isSent = !!sentTargets[fId];
              const isPending = !!pendingTargets[fId];
              const name = userNames[fId] || `User ${fId.slice(0, 6)}`;
              return (
                <div
                  key={fId}
                  className={classes(PADDING[2.5], RADIUS.panel, COLOR.hoverW5, 'flex items-center justify-between border border-transparent', COLOR.hoverEdgeStrong, MOTION.transition.micro)}
                >
                  <div className={classes('flex items-center', GAP[3])}>
                    <div className={classes('w-10 h-10', RADIUS.pill, COLOR.glassW20, 'overflow-hidden border', COLOR.edge, 'flex items-center justify-center', TYPE.body, WEIGHT.bold)}>
                      {profilePics[fId] ? (
                        <img src={resolveMediaUrl(profilePics[fId])} alt="" className="w-full h-full object-cover" />
                      ) : (
                        fId.substring(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                       <span className={classes(TYPE.body, WEIGHT.bold, COLOR.fg, 'block truncate max-w-[160px]')}>{name}</span>
                      <span className={classes(TYPE.caption, COLOR.muted)}>Direct Message</span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant={isSent ? 'secondary' : 'primary'}
                    onClick={() => void handleSendDirectShare(fId, name)}
                    disabled={isSent || isPending || !identity}
                    title={!identity ? 'Log in to share' : undefined}
                  >
                    {isSent ? 'Sent' : isPending ? 'Sending…' : 'Send'}
                  </Button>
                </div>
              );
            })}
          </div>

          {groups.length > 0 && (
            <div className={classes('space-y-1.5')}>
              <span className={classes(TYPE.caption, WEIGHT.bold, 'uppercase', TRACKING.wider, COLOR.muted, PADDING_X[1])}>Groups</span>
              {groups
                .filter((g) => g.name.toLowerCase().includes(shareSearch.toLowerCase()))
                .map((g) => {
                  const isSent = !!sentTargets[g.id];
                  const isPending = !!pendingTargets[g.id];
                  return (
                    <div
                      key={g.id}
                      className={classes(PADDING[2.5], RADIUS.panel, COLOR.hoverW5, 'flex items-center justify-between border border-transparent', COLOR.hoverEdgeStrong, MOTION.transition.micro)}
                    >
                      <div className={classes('flex items-center', GAP[3])}>
                        <div className={classes('w-10 h-10', RADIUS.panel, COLOR.glassW20, 'overflow-hidden border', COLOR.edge, 'flex items-center justify-center', TYPE.body, WEIGHT.bold)}>
                          {g.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <span className={classes(TYPE.body, WEIGHT.bold, COLOR.fg, 'block truncate max-w-[160px]')}>{g.name}</span>
                          <span className={classes(TYPE.caption, COLOR.muted)}>{g.member_count} members</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant={isSent ? 'secondary' : 'primary'}
                        onClick={() => void handleSendGroupShare(g.id, g.name)}
                        disabled={isSent || isPending || !identity}
                        title={!identity ? 'Log in to share' : undefined}
                      >
                        {isSent ? 'Sent' : isPending ? 'Sending…' : 'Send'}
                      </Button>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Modal Bottom Actions */}
        <div className={classes(PADDING[3], 'border-t', COLOR.edge, COLOR.interactive, 'flex items-center', GAP[2])}>
          <Button type="button" variant="secondary" onClick={handleCopyLink} className={classes('flex-1', 'flex items-center justify-center', GAP[1.5])}>
            <Link2 className={ICON.md} />
            <span>Copy Link</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
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
            className={classes('flex-1', 'flex items-center justify-center', GAP[1.5])}
          >
            <Share2 className={ICON.md} />
            <span>More Options</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
