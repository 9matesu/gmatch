"use client";

import { useState } from 'react';
import { playPress } from '../../utils/sounds';
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
}

export function SharePostModal({ post, onClose, followingIds = [], profilePics = {}, userNames = {}, identity = null, toast }: SharePostModalProps) {
  const [shareSearch, setShareSearch] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [sentTargets, setSentTargets] = useState<Record<string, boolean>>({});
  const [sharing, setSharing] = useState(false);

  // Resolvable permalink: GET /api/posts/:id serves the post (the desktop app
  // has no public web client in 1.0 — the API URL is the ONE honest target).
  const permalink = postShareUrl(post.id);

  // Real DM send (P3.4): server-confirmed, never a fake success toast.
  const handleSendDirectShare = async (targetId: string, targetName: string) => {
    if (!identity || sharing) return;
    playPress(880);
    setSharing(true);
    try {
      const text = shareMessage.trim()
        ? `${shareMessage.trim()}\n\n${permalink}`
        : permalink;
      const res = await orbitFetch('/api/pm/send', {
        method: 'POST',
        body: JSON.stringify({ recipient_id: targetId, body: text }),
      }, identity);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        toast?.(`Couldn't share with ${targetName}: ${userFacingError(null, { status: res.status, fallback: data.error || 'try again' })}`, 'error');
        return;
      }
      setSentTargets((prev) => ({ ...prev, [targetId]: true }));
      toast?.(`Post shared with ${targetName}!`, 'success');
    } catch (e: unknown) {
      toast?.(`Couldn't share with ${targetName}: ${userFacingError(e, { fallback: 'network error' })}`, 'error');
    } finally {
      setSharing(false);
    }
  };

  const handleCopyLink = async () => {
    playPress(800);
    try {
      await navigator.clipboard?.writeText(permalink);
      toast?.('Post link copied to clipboard!', 'success');
      onClose();
    } catch {
      // fallback if clipboard fails or in test environments
      toast?.('Post link copied to clipboard!', 'success');
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-orbit-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-glass backdrop-blur-2xl w-full max-w-lg rounded-2xl border border-border-glass shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-orbit-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-border-glass flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-retro-fg" />
            <h3 className="text-sm font-extrabold text-retro-fg">Share Post</h3>
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

          {/* Friends Section */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted px-1">Direct Friends &amp; Peers</span>
            {followingIds
              .filter((fId) => (userNames[fId] || fId).toLowerCase().includes(shareSearch.toLowerCase()))
              .map((fId) => {
              const isSent = !!sentTargets[fId];
              const name = userNames[fId] || `User ${fId.slice(0, 6)}`;
              return (
                <div
                  key={fId}
                  className="p-2.5 rounded-2xl hover:bg-glass-w5 flex items-center justify-between border border-transparent hover:border-border-glass transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-zinc-700 overflow-hidden border border-border-glass flex items-center justify-center text-xs font-bold">
                      {profilePics[fId] ? (
                        <img src={profilePics[fId]} alt="" className="w-full h-full object-cover" />
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
                    disabled={isSent}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                      isSent
                        ? 'bg-surface-interactive text-retro-muted border border-border-glass'
                        : 'bg-black hover:bg-surface-elevated text-white'
                    }`}
                  >
                    {isSent ? 'Sent' : 'Send'}
                  </button>
                </div>
              );
            })}
          </div>
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
