"use client";

import { useState, useEffect } from 'react';
import { playPress } from '../../utils/sounds';
import {
  Grid,
  Bookmark,
  Layers,
  Settings,
  Share2,
  ExternalLink,
  Heart,
  MessageCircle,
  Camera,
  Repeat,
  CheckCircle2,
  Flame,
  Play,
} from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject as StoredCard } from '@orbit/shared';
import type { FeedPost } from '../feed/GMatchFeed';
import { ProfileEditorModal } from './ProfileEditorModal';
import { ProfilePicModal } from './ProfilePicModal';
import { InstagramPostModal } from '../feed/InstagramPostModal';
import { ObjectImage } from '../ObjectImage';
import { isMediaVideo, resolveMediaUrl } from '../../utils/media';
import { saveUserProfile } from '../../utils/profile';
import { profileShareUrl } from '../../utils/api';

export function GMatchProfile({
  identity,
  myUser,
  profilePic,
  posts = [],
  cards = [],
  savedPosts = [],
  repostPosts = [],
  followersCount = 0,
  followingCount = 0,
  onOpenSettings,
  onOpenFollowers,
  onOpenCardViewer,
  onProfileUpdated,
  toast,
}: {
  identity: OrbitIdentity | null;
  myUser: any;
  profilePic?: string;
  posts: FeedPost[];
  cards: StoredCard[];
  savedPosts?: FeedPost[];
  repostPosts?: FeedPost[];
  followersCount?: number;
  followingCount?: number;
  activePowerups?: string[];
  onOpenSettings?: () => void;
  onOpenFollowers?: (tab: 'followers' | 'following') => void;
  onOpenCardViewer?: (card: any) => void;
  onProfileUpdated?: (updated: { name: string; bio: string; website: string; pfpUrl?: string }) => void;
  onArchivePost?: (postId: string) => void;
  onDeletePost?: (postId: string) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const [profileTab, setProfileTab] = useState<'posts' | 'saved' | 'reposts' | 'cards'>('posts');
  const [showEditor, setShowEditor] = useState(false);
  const [activeLightboxPost, setActiveLightboxPost] = useState<FeedPost | null>(null);
  const [bio, setBio] = useState(() => myUser?.bio || '');
  const [website, setWebsite] = useState(() => myUser?.website || '');
  const [displayName, setDisplayName] = useState(
    () => myUser?.display_name?.trim() || myUser?.name?.trim() || (typeof window !== 'undefined' ? localStorage.getItem('orbit_display_name') : '') || 'Unknown User'
  );
  const [pfp, setPfp] = useState(() => profilePic || myUser?.pfp_url || '');

  useEffect(() => {
    if (myUser) {
      const name = myUser.display_name || myUser.name;
      if (name) setDisplayName(name);
      if (myUser.bio !== undefined) setBio(myUser.bio);
      if (myUser.website !== undefined) setWebsite(myUser.website);
      if (myUser.pfp_url) setPfp(myUser.pfp_url);
    }
  }, [myUser]);

  useEffect(() => {
    if (profilePic) {
      setPfp(profilePic);
    }
  }, [profilePic]);
  const activePowerups: string[] = [];

  const isFlashing = activePowerups.includes('powerup_flash') || activePowerups.includes('flash');
  const isVerified = activePowerups.includes('powerup_verified') || activePowerups.includes('verified') || myUser?.is_admin;

  const myPosts = posts.filter(
    (p) => identity && p.author_id === identity.orbitId && !p.is_archived && !p.id.startsWith('stream_') && !p.id.startsWith('booru_') && !p.is_sponsored
  );
  const displayPosts = myPosts;

  const isSelf = Boolean(identity && (!myUser?.id || myUser?.id === identity.orbitId));
  const totalLikes = myPosts.reduce((acc, p) => acc + (p.like_count || 0), 0) + (myUser?.likes_received || 0);
  const goonCoins = myUser?.balance ?? 0;
  const [showPfpModal, setShowPfpModal] = useState(false);

  const handleShareProfile = async () => {
    playPress(800);
    const profileUrl = identity ? profileShareUrl(identity.orbitId) : ''
    if (!profileUrl) { toast?.('Sign in to share your profile', 'warning'); return }
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(profileUrl);
        toast?.('Profile link copied', 'success');
      }
    } catch {
      toast?.('Failed to copy profile link', 'error');
    }
  };

  const handleSavePfp = async (newPfp: string) => {
    setPfp(newPfp);
    if (identity) {
      try {
        let persisted = newPfp;
        if (persisted.startsWith('blob:')) {
          const blob = await fetch(persisted).then((r) => r.blob());
          persisted = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        }
        const res = await saveUserProfile(identity, { pfp_url: persisted });
        if (!res.ok) throw new Error(`Profile save failed (${res.status})`);
      } catch {
        toast?.('Could not save profile photo', 'error');
      }
    }
    onProfileUpdated?.({
      name: displayName,
      bio,
      website,
      pfpUrl: newPfp,
    });
  };

  const effectiveFollowersCount = followersCount ?? myUser?.followers_count ?? 0;
  const effectiveFollowingCount = followingCount ?? myUser?.following_count ?? 0;

  const stats = [
    { label: 'posts', value: displayPosts.length, onClick: () => setProfileTab('posts') },
    { value: effectiveFollowersCount, label: 'followers', onClick: () => { playPress(700); onOpenFollowers?.('followers'); } },
    { value: effectiveFollowingCount, label: 'following', onClick: () => { playPress(700); onOpenFollowers?.('following'); } },
    { value: totalLikes, label: 'likes' },
  ];

  if (isSelf) {
    stats.push({ value: goonCoins, label: 'coins' } as any);
  }

  const tabs = [
    { id: 'posts', label: 'Posts', icon: Grid },
    { id: 'saved', label: 'Saved', icon: Bookmark },
    { id: 'reposts', label: 'Reposts', icon: Repeat },
    { id: 'cards', label: 'Cards', icon: Layers },
  ];

  return (
    <div className="w-full bg-surface-canvas font-sans select-none border border-border-glass rounded-xl overflow-hidden text-retro-fg animate-orbit-fade-in shadow-xl">
      {/* Profile Header */}
      <div className="bg-surface-raised border-b border-border-glass p-4 sm:p-6 flex flex-col gap-4">
        {/* Avatar & Stats */}
        <div className="flex items-center gap-5 sm:gap-6">
          {/* Avatar */}
          <button
            type="button"
            onClick={() => {
              if (isSelf) {
                playPress(750);
                setShowPfpModal(true);
              }
            }}
            disabled={!isSelf}
            aria-label={isSelf ? 'Change profile photo' : displayName}
            className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden shrink-0 group border-2 p-0 text-left ${
              isSelf ? 'cursor-pointer' : 'cursor-default'
            } ${
              isFlashing ? 'border-retro-accent' : 'border-border-glass'
            }`}
          >
            {pfp ? (
              <img
                src={resolveMediaUrl(pfp)}
                alt={displayName}
                onError={() => setPfp('')}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full bg-surface-interactive flex items-center justify-center text-xl sm:text-2xl font-medium text-retro-muted">
                {(displayName || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            {isSelf && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="w-5 h-5 text-white" />
              </div>
            )}
          </button>

          {/* Stats */}
          <div className="flex-1 flex items-center justify-around text-center gap-2">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col cursor-pointer"
                onClick={(stat as any).onClick}
              >
                <span className="text-sm sm:text-base font-semibold text-retro-fg tabular-nums">
                  {stat.value}
                </span>
                <span className="text-xs text-retro-muted">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Name & Bio */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-retro-fg">{displayName}</h2>
            {isVerified && (
              <span title="Verified">
                <CheckCircle2 className="w-4 h-4 text-retro-accent shrink-0" />
              </span>
            )}
            {isFlashing && (
              <span title="Flash active">
                <Flame className="w-3.5 h-3.5 text-retro-accent fill-retro-accent" />
              </span>
            )}
          </div>
          {bio && (
            <p className="text-xs text-retro-body whitespace-pre-line">{bio}</p>
          )}
          {website && (
            <a
              href={website.startsWith('http') ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-retro-accent hover:underline flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              <span>{website.replace(/^https?:\/\//, '')}</span>
            </a>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { playPress(800); setShowEditor(true); }}
            className="flex-1 py-2 px-3 rounded-lg bg-surface-interactive border border-border-glass hover:border-border-glass text-retro-body font-medium text-xs transition-colors cursor-pointer"
          >
            Edit profile
          </button>

          <button
            type="button"
            onClick={handleShareProfile}
            className="flex-1 py-2 px-3 rounded-lg bg-surface-interactive border border-border-glass hover:border-border-glass text-retro-body font-medium text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share</span>
          </button>

          <button
            type="button"
            onClick={() => { playPress(750); onOpenSettings?.(); }}
            title="Settings"
            aria-label="Settings"
            className="p-2 rounded-lg bg-surface-interactive border border-border-glass hover:border-border-glass text-retro-body cursor-pointer transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface-raised border-b border-border-glass flex items-center gap-1 px-2 py-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = profileTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => { playPress(750); setProfileTab(tab.id as any); }}
              className={`py-1.5 px-3 flex items-center justify-center gap-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${isActive
                  ? 'bg-glass-w12 text-retro-fg'
                  : 'text-retro-muted hover:text-retro-body'
                }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div className="p-1 sm:p-1.5">
        {profileTab === 'posts' && (
          <div className="grid grid-cols-3 gap-0.5 sm:gap-1">
            {displayPosts.map((post) => (
              <div
                key={post.id}
                onClick={() => {
                  setActiveLightboxPost(post);
                }}
                className="relative aspect-square bg-surface-canvas overflow-hidden cursor-pointer group"
              >
                <ObjectImage
                  objectId={post.id}
                  contentUrl={post.url}
                  identity={identity}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                  videoClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                  muted
                  autoPlay={false}
                  playsInline
                />
                {isMediaVideo(post.url) && (
                  <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-xs rounded-md p-1 pointer-events-none text-white z-10">
                    <Play className="w-3 h-3 fill-white" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 text-white text-xs font-medium z-10">
                  <div className="flex items-center gap-1">
                    <Heart className="w-4 h-4 fill-white" />
                    <span>{post.like_count || 0}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MessageCircle className="w-4 h-4 fill-white" />
                    <span>{post.comment_count || 0}</span>
                  </div>
                </div>
              </div>
            ))}
            {displayPosts.length === 0 && (
              <div className="col-span-3 py-16 text-center text-xs text-retro-muted">
                No posts yet
              </div>
            )}
          </div>
        )}

        {profileTab === 'saved' && (
          <div className="grid grid-cols-3 gap-0.5 sm:gap-1">
            {(savedPosts && savedPosts.length > 0 ? savedPosts : []).map((post) => (
              <div
                key={post.id}
                onClick={() => {
                  setActiveLightboxPost(post);
                }}
                className="relative aspect-square bg-surface-canvas overflow-hidden cursor-pointer group"
              >
                <ObjectImage
                  objectId={post.id}
                  contentUrl={post.url}
                  identity={identity}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                  videoClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                  muted
                  autoPlay={false}
                  playsInline
                />
                {isMediaVideo(post.url) && (
                  <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-xs rounded-md p-1 pointer-events-none text-white z-10">
                    <Play className="w-3 h-3 fill-white" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white z-10">
                  <Bookmark className="w-5 h-5 fill-white" />
                </div>
              </div>
            ))}
            {(!savedPosts || savedPosts.length === 0) && (
              <div className="col-span-3 py-16 text-center text-xs text-retro-muted">
                No saved posts
              </div>
            )}
          </div>
        )}

        {profileTab === 'reposts' && (
          <div className="grid grid-cols-3 gap-0.5 sm:gap-1">
            {(repostPosts && repostPosts.length > 0 ? repostPosts : []).map((post) => (
              <div
                key={post.id}
                onClick={() => {
                  setActiveLightboxPost(post);
                }}
                className="relative aspect-square bg-surface-canvas overflow-hidden cursor-pointer group"
              >
                <ObjectImage
                  contentUrl={post.url}
                  objectId={post.id}
                  identity={identity}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                  videoClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                  muted
                  autoPlay={false}
                  playsInline
                />
                {isMediaVideo(post.url) && (
                  <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-xs rounded-md p-1 pointer-events-none text-white z-10">
                    <Play className="w-3 h-3 fill-white" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-retro-online z-10">
                  <Repeat className="w-5 h-5" />
                </div>
              </div>
            ))}
            {repostPosts.length === 0 && (
              <div className="col-span-3 py-16 text-center text-xs text-retro-muted">
                No reposts yet
              </div>
            )}
          </div>
        )}

        {profileTab === 'cards' && (
          <div className="grid grid-cols-3 gap-0.5 sm:gap-1">
            {cards.slice(0, 12).map((card) => (
              <div
                key={card.id}
                onClick={() => onOpenCardViewer?.(card)}
                className="relative aspect-square bg-surface-canvas overflow-hidden cursor-pointer group"
              >
                <ObjectImage
                  contentUrl={card.content_url || (card as any).data || (card as any).url || `/api/objects/${card.id}`}
                  objectId={card.id}
                  identity={identity}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                  videoClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                  muted
                  autoPlay={false}
                  playsInline
                />
                {isMediaVideo(card.content_url || (card as any).url) && (
                  <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-xs rounded-md p-1 pointer-events-none text-white z-10">
                    <Play className="w-3 h-3 fill-white" />
                  </div>
                )}
              </div>
            ))}
            {cards.length === 0 && (
              <div className="col-span-3 py-16 text-center text-xs text-retro-muted">
                No cards yet
              </div>
            )}
          </div>
        )}
      </div>

      {/* Profile Picture Modal */}
      {showPfpModal && (
        <ProfilePicModal
          isOpen={showPfpModal}
          currentPfp={pfp}
          onClose={() => setShowPfpModal(false)}
          onSave={(newPfp) => {
            void handleSavePfp(newPfp);
          }}
          toast={toast}
        />
      )}

      {/* Profile Editor Modal */}
      {showEditor && (
        <ProfileEditorModal
          identity={identity}
          initialName={displayName}
          initialBio={bio}
          initialWebsite={website}
          initialPfp={pfp}
          onClose={() => setShowEditor(false)}
          onProfileUpdated={(updated) => {
            setDisplayName(updated.name);
            setBio(updated.bio);
            setWebsite(updated.website);
            if (updated.pfpUrl) setPfp(updated.pfpUrl);
            onProfileUpdated?.(updated);
          }}
          toast={toast}
        />
      )}

      {/* Lightbox for clicked post */}
      {activeLightboxPost && (
        <InstagramPostModal
          post={activeLightboxPost}
          isOpen={Boolean(activeLightboxPost)}
          onClose={() => setActiveLightboxPost(null)}
          identity={identity}
          profilePics={profilePic ? { [identity?.orbitId || '']: profilePic } : {}}
          isLiked={activeLightboxPost.is_liked}
          isSaved={activeLightboxPost.is_saved}
          likeCount={activeLightboxPost.like_count}
          comments={activeLightboxPost.comments}
          toast={toast}
        />
      )}
    </div>
  );
}
