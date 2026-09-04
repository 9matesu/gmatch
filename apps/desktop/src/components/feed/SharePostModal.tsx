"use client";

import { useState } from 'react';
import { playPress } from '../../utils/sounds';
import {
  Send,
  Search,
  X,
  Link2,
  Share2,
  Users,
  Globe,
  Gamepad2,
  Palette,
  ShieldCheck,
} from 'lucide-react';
import type { FeedPost } from './GoonMatchFeed';
import { ObjectImage } from '../ObjectImage';

type IdentityLike = {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

const PRESET_CHAT_GROUPS = [
  { id: 'group_general', name: 'General Lounge', icon: 'general', desc: 'Main public community' },
  { id: 'group_arcade', name: 'Arcade Duelists', icon: 'arcade', desc: 'Card game matchmaking' },
  { id: 'group_anime', name: 'Anime Syndicate', icon: 'anime', desc: 'Art & Booru showcase' },
  { id: 'group_patrol', name: 'Mod Patrol HQ', icon: 'patrol', desc: 'Community moderators' },
];

const GROUP_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  general: Globe,
  arcade: Gamepad2,
  anime: Palette,
  patrol: ShieldCheck,
}

interface SharePostModalProps {
  post: FeedPost;
  onClose: () => void;
  followingIds?: string[];
  profilePics?: Record<string, string>;
  identity?: IdentityLike | null;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function SharePostModal({ post, onClose, followingIds = [], profilePics = {}, identity = null, toast }: SharePostModalProps) {
  const [shareSearch, setShareSearch] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [sentTargets, setSentTargets] = useState<Record<string, boolean>>({});

  const handleSendDirectShare = (targetId: string, targetName: string) => {
    playPress(880);
    setSentTargets((prev) => ({ ...prev, [targetId]: true }));
    toast?.(`Post shared with ${targetName}!`, 'success');
  };

  const handleCopyLink = () => {
    playPress(800);
    navigator.clipboard.writeText(`https://goonmatch.fly.dev`);
    toast?.('Post link copied to clipboard!', 'success');
    onClose();
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
            <p className="text-[11px] text-retro-muted truncate">{post.caption || 'Post'}</p>
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
          {/* Groups Section */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted px-1">Community Groups</span>
            {PRESET_CHAT_GROUPS.filter((g) => g.name.toLowerCase().includes(shareSearch.toLowerCase())).map((grp) => {
              const isSent = !!sentTargets[grp.id];
              return (
                <div
                  key={grp.id}
                  className="p-2.5 rounded-2xl hover:bg-white/5 flex items-center justify-between border border-transparent hover:border-border-glass transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-retro-accent/10 border border-border-glass flex items-center justify-center">
                      {(() => { const Icon = GROUP_ICON_MAP[grp.icon] || Users; return <Icon className="w-5 h-5 text-retro-accent" /> })()}
                    </div>
                    <div>
                      <span className="text-xs font-bold text-retro-fg block">{grp.name}</span>
                      <span className="text-[10px] text-retro-muted">{grp.desc}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSendDirectShare(grp.id, grp.name)}
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

          {/* Friends Section */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted px-1">Direct Friends &amp; Peers</span>
            {followingIds.map((fId) => {
              const isSent = !!sentTargets[fId];
              return (
                <div
                  key={fId}
                  className="p-2.5 rounded-2xl hover:bg-white/5 flex items-center justify-between border border-transparent hover:border-border-glass transition-colors"
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
                       <span className="text-xs font-bold text-retro-fg block truncate max-w-[160px]">Unknown User</span>
                      <span className="text-[10px] text-retro-muted">Direct Message</span>
                    </div>
                  </div>

                  <button
                    type="button"
                     onClick={() => handleSendDirectShare(fId, 'Unknown User')}
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
                  title: `goonMatch post by ${post.author_name}`,
                  url: 'https://goonmatch.fly.dev',
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
