"use client";

import { useState, useEffect, useCallback } from 'react';
import { playPress, playWin, playMatchFound, playChime } from '../../utils/sounds';
import { ShieldAlert, CheckCircle2, XCircle, Flame, Trophy, Sparkles, AlertTriangle, Heart, Coins, Lock, CheckSquare, EyeOff, Send, RefreshCw, Info } from 'lucide-react';
import { fetchUniversalFeed, isExplicitFeederImage, type FeederImage } from '../../utils/universalImageFeeder';
import { orbitFetch } from '../../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import type { FeedPost } from './GoonMatchFeed';
import { ObjectImage } from '../ObjectImage';

interface ModPatrolWidgetProps {
  identity?: OrbitIdentity | null;
  currentUser?: { is_moderator?: boolean; is_admin?: boolean; score?: number; likes_given?: number } | null;
  feedPosts?: FeedPost[];
  onAddScore?: (points: number) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

interface ReportedItem {
  report_id?: string;
  post_id: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  url: string;
  caption: string;
  reason: string;
  category: string;
  reported_at: string;
  like_count: number;
  comment_count: number;
}

export function ModPatrolWidget({
  identity,
  currentUser,
  feedPosts = [],
  onAddScore,
  toast,
}: ModPatrolWidgetProps) {
  const [activeTab, setActiveTab] = useState<'simulated' | 'real'>('simulated');
  const [isPlaying, setIsPlaying] = useState(false);

  // Simulated Game State
  const [feederQueue, setFeederQueue] = useState<FeederImage[]>([]);
  const [currentFeederIndex, setCurrentFeederIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [earnedLikes, setEarnedLikes] = useState(0);
  const [feedback, setFeedback] = useState<{ text: string; correct: boolean } | null>(null);
  const [timeLeft, setTimeLeft] = useState(30);
  const [showAllocateLikesModal, setShowAllocateLikesModal] = useState(false);
  const [selectedTargetPostId, setSelectedTargetPostId] = useState<string>('');
  const [isAllocatingLikes, setIsAllocatingLikes] = useState(false);

  // Real Moderation State
  const [canModerate, setCanModerate] = useState(false);
  const [signedDeal, setSignedDeal] = useState(false);
  const [showAgreementModal, setShowAgreementModal] = useState(false);
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [realQueue, setRealQueue] = useState<ReportedItem[]>([]);
  const [isLoadingRealQueue, setIsLoadingRealQueue] = useState(false);
  const [currentRealIndex, setCurrentRealIndex] = useState(0);
  const [earnedCoins, setEarnedCoins] = useState(0);

  const isModerator = Boolean(currentUser?.is_moderator || currentUser?.is_admin);

  // Check moderator privileges
  useEffect(() => {
    if (!identity) return;
    if (isModerator) {
      setCanModerate(true);
      return;
    }
    orbitFetch('/api/moderation/status', {}, identity)
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (data?.can_moderate) setCanModerate(true);
      })
      .catch(() => { });
  }, [identity, isModerator]);

  // Load feed images for Simulated Game
  const loadFeederImages = useCallback(async () => {
    try {
      const items = await fetchUniversalFeed({ limit: 12, rating: 'all' });
      if (items.length > 0) {
        setFeederQueue(items);
        setCurrentFeederIndex(0);
      }
    } catch { }
  }, []);

  useEffect(() => {
    loadFeederImages();
  }, [loadFeederImages]);

  // Load Real Moderation Queue
  const loadRealQueue = useCallback(async () => {
    if (!identity || !canModerate) return;
    setIsLoadingRealQueue(true);
    try {
      const res = await orbitFetch('/api/moderation/queue', {}, identity);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.items)) {
          setRealQueue(data.items);
          setCurrentRealIndex(0);
        }
      }
    } catch { } finally {
      setIsLoadingRealQueue(false);
    }
  }, [identity, canModerate]);

  useEffect(() => {
    if (activeTab === 'real' && signedDeal) {
      loadRealQueue();
    }
  }, [activeTab, signedDeal, loadRealQueue]);

  // Simulated Timer Countdown
  useEffect(() => {
    if (!isPlaying || activeTab !== 'simulated') return;
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          setIsPlaying(false);
          playMatchFound();
          // Convert streak/score into earned likes reward
          const likesAwarded = Math.max(1, Math.floor(score / 40) + 1);
          setEarnedLikes((prev) => prev + likesAwarded);
          toast?.(`Shift complete! You earned ${likesAwarded} Likes to send to any post.`, 'success');
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying, activeTab, score, toast]);

  const startSimulatedGame = () => {
    playPress(900);
    setScore(0);
    setStreak(0);
    setTimeLeft(30);
    setIsPlaying(true);
    loadFeederImages();
  };

  const handleSimulatedDecision = (approved: boolean) => {
    const current = feederQueue[currentFeederIndex];
    if (!current) return;

    const isPornographic = isExplicitFeederImage(current);

    // Rule: Ban non-pornographic (SFW), Keep pornographic (NSFW)
    const isCorrect = (approved && isPornographic) || (!approved && !isPornographic);

    if (isCorrect) {
      playWin();
      const points = 15 * Math.max(1, streak + 1);
      setScore((s) => s + points);
      setStreak((st) => st + 1);
      setFeedback({ text: `+${points} ${isPornographic ? 'NSFW Kept!' : 'SFW Banned!'}`, correct: true });
      onAddScore?.(points);
    } else {
      playPress(350);
      setStreak(0);
      setFeedback({
        text: isPornographic ? 'Failed: NSFW must be KEPT' : 'Failed: SFW must be BANNED',
        correct: false,
      });
    }

    setTimeout(() => {
      setFeedback(null);
      setCurrentFeederIndex((prev) => (prev + 1) % Math.max(1, feederQueue.length));
    }, 550);
  };

  // Submit Real Moderation Action
  const handleRealDecision = async (action: 'approve' | 'flag_sensitive' | 'hide' | 'delete') => {
    if (!identity || realQueue.length === 0) return;
    const current = realQueue[currentRealIndex];
    if (!current) return;

    playPress(800);
    try {
      const res = await orbitFetch('/api/moderation/review', {
        method: 'POST',
        body: JSON.stringify({
          report_id: current.report_id,
          post_id: current.post_id,
          action,
          reason: action === 'flag_sensitive' ? 'Sensitive content flagged by community moderator' : 'Approved by moderator',
        }),
      }, identity);

      if (res.ok) {
        playWin();
        setEarnedCoins((prev) => prev + 25);
        toast?.(action === 'flag_sensitive' ? 'Post flagged as sensitive and hidden from timeline. +25 Goon Coins earned!' : 'Post approved. +25 Goon Coins earned!', 'success');
        setRealQueue((prev) => prev.filter((_, idx) => idx !== currentRealIndex));
      } else {
        toast?.('Failed to submit moderation review', 'error');
      }
    } catch {
      toast?.('Network error during review', 'error');
    }
  };

  // Allocate earned likes to a selected post
  const handleAllocateLikes = async () => {
    if (!identity || !selectedTargetPostId || earnedLikes <= 0) return;
    setIsAllocatingLikes(true);
    try {
      const res = await orbitFetch('/api/moderation/simulated-reward', {
        method: 'POST',
        body: JSON.stringify({
          target_post_id: selectedTargetPostId,
          likes_count: earnedLikes,
        }),
      }, identity);

      if (res.ok) {
        playChime();
        toast?.(`Sent ${earnedLikes} likes to post!`, 'success');
        setEarnedLikes(0);
        setShowAllocateLikesModal(false);
      } else {
        toast?.('Failed to allocate likes', 'error');
      }
    } catch {
      toast?.('Network error while allocating likes', 'error');
    } finally {
      setIsAllocatingLikes(false);
    }
  };

  const currentFeederItem = feederQueue[currentFeederIndex] || null;
  const currentRealItem = realQueue[currentRealIndex] || null;

  return (
    <div className="w-full bg-surface-raised border border-retro-border rounded-lg p-4 sm:p-5 font-sans select-none text-retro-fg overflow-hidden my-4 relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-retro-border gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-surface-interactive text-retro-body flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-medium text-retro-fg">Mod Patrol</h3>
            </div>
            <p className="text-xs text-retro-muted">Content review shifts</p>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center bg-surface-interactive border border-retro-border p-0.5 rounded-md gap-0.5">
          <button
            type="button"
            onClick={() => { playPress(700); setActiveTab('simulated'); setIsPlaying(false); }}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${activeTab === 'simulated' ? 'bg-surface-raised text-retro-fg' : 'text-retro-muted hover:text-retro-fg'
              }`}
          >
            Practice
          </button>

          <button
            type="button"
            onClick={() => {
              playPress(700);
              if (!canModerate) {
                toast?.('Real Moderation is restricted to authorized moderators.', 'warning');
                return;
              }
              setActiveTab('real');
              if (!signedDeal) setShowAgreementModal(true);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer flex items-center gap-1 ${activeTab === 'real' ? 'bg-surface-raised text-retro-fg' : 'text-retro-muted hover:text-retro-fg'
              }`}
          >
            {!canModerate && <Lock className="w-3 h-3 text-retro-muted" />}
            <span>Live</span>
          </button>
        </div>
      </div>

      {/* ─── TAB 1: SIMULATED / BOT MODERATION (EARN LIKES) ─── */}
      {activeTab === 'simulated' && (
        <div className="pt-4">
          {!isPlaying ? (
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-12 h-12 rounded-lg bg-surface-interactive text-retro-body flex items-center justify-center">
                <Sparkles className="w-6 h-6" />
              </div>

              <div className="space-y-1.5 max-w-sm">
                <h4 className="text-sm font-medium text-retro-fg">Practice Patrol</h4>
                <p className="text-xs text-retro-muted leading-relaxed">
                  Review bot and anime API feeds. Correct reviews earn <strong className="text-retro-fg font-medium">Likes</strong> to boost onto your posts.
                </p>
              </div>

              {earnedLikes > 0 && (
                <div className="flex items-center gap-2 p-2 px-3 rounded-lg bg-surface-interactive border border-retro-border text-xs text-retro-fg">
                  <Heart className="w-4 h-4 text-retro-accent fill-retro-accent" />
                  <span>{earnedLikes} likes ready to allocate</span>
                  <button
                    type="button"
                    onClick={() => setShowAllocateLikesModal(true)}
                    className="ml-2 px-2.5 py-1 bg-retro-accent text-black rounded text-xs font-medium cursor-pointer hover:bg-retro-accent-hover"
                  >
                    Allocate
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={startSimulatedGame}
                className="py-2.5 px-6 rounded-lg bg-retro-accent hover:bg-retro-accent-hover text-black font-medium text-xs cursor-pointer transition-colors flex items-center gap-2"
              >
                <Trophy className="w-4 h-4" />
                <span>Start 30s Shift</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Top Shift Status Bar */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-retro-warning bg-retro-warning/5 px-2.5 py-1 rounded-md border border-retro-warning/20">
                  <Flame className="w-3.5 h-3.5" />
                  <span>{streak}x streak</span>
                </div>
                <div className="text-xs font-mono font-medium text-retro-accent bg-surface-interactive px-2.5 py-1 rounded-md">
                  {timeLeft}s
                </div>
              </div>

              {/* Media Card Review */}
              {currentFeederItem ? (
                <div className="relative rounded-lg border border-retro-border overflow-hidden bg-surface-interactive p-3 flex flex-col gap-2">
                  {feedback && (
                    <div className={`absolute inset-0 z-20 backdrop-blur-xs flex items-center justify-center text-sm font-medium animate-orbit-pop ${feedback.correct ? 'bg-retro-online/10 text-retro-online' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                      {feedback.text}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-retro-body">{currentFeederItem.source}</span>
                    <span className="text-[11px] text-retro-muted font-mono">#{currentFeederItem.category}</span>
                  </div>

                  <div className="w-full h-44 rounded-lg bg-surface-elevated overflow-hidden flex items-center justify-center relative">
                    <ObjectImage contentUrl={currentFeederItem.url} identity={identity ?? null} alt="" className="w-full h-full object-cover" />
                  </div>

                  {currentFeederItem.caption && (
                    <p className="text-xs text-retro-muted line-clamp-1">{currentFeederItem.caption}</p>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-retro-muted">Loading feeder streams...</div>
              )}

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => handleSimulatedDecision(false)}
                  className="py-2.5 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/15 text-rose-400 border border-rose-500/20 font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  <span>Flag</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSimulatedDecision(true)}
                  className="py-2.5 px-3 rounded-lg bg-retro-online/10 hover:bg-retro-online/15 text-retro-online border border-retro-online/20 font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Approve</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 2: REAL COMMUNITY MODERATION (EARN GOON COINS) ─── */}
      {activeTab === 'real' && (
        <div className="pt-4">
          {!canModerate ? (
            <div className="py-8 text-center space-y-2">
              <Lock className="w-8 h-8 text-retro-muted mx-auto" />
              <h4 className="text-xs font-medium text-retro-body">Moderator Flag Required</h4>
              <p className="text-xs text-retro-muted max-w-xs mx-auto">
                Real moderation is only available to trusted users flagged by an administrator.
              </p>
            </div>
          ) : !signedDeal ? (
            <div className="py-8 text-center space-y-3">
              <ShieldAlert className="w-10 h-10 text-retro-accent mx-auto" />
              <div className="space-y-1 max-w-sm mx-auto">
                <h4 className="text-sm font-medium text-retro-fg">Moderation Agreement</h4>
                <p className="text-xs text-retro-muted leading-relaxed">
                  You are authorized to review real user reports. Flagging content hides it from the timeline.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAgreementModal(true)}
                className="py-2.5 px-6 rounded-lg bg-retro-accent hover:bg-retro-accent-hover text-black font-medium text-xs cursor-pointer transition-colors inline-flex items-center gap-2"
              >
                <CheckSquare className="w-4 h-4" />
                <span>Sign Agreement</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-retro-accent bg-surface-interactive px-2.5 py-1 rounded-md">
                  <Coins className="w-3.5 h-3.5 text-retro-accent" />
                  <span>+{earnedCoins} earned</span>
                </div>
                <button
                  type="button"
                  onClick={loadRealQueue}
                  className="text-xs text-retro-muted hover:text-retro-fg inline-flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Refresh ({realQueue.length})</span>
                </button>
              </div>

              {isLoadingRealQueue ? (
                <div className="py-10 text-center text-xs text-retro-muted">Loading reported posts...</div>
              ) : realQueue.length === 0 ? (
                <div className="py-8 text-center space-y-2 bg-surface-interactive rounded-lg border border-retro-border p-6">
                  <CheckCircle2 className="w-8 h-8 text-retro-online mx-auto" />
                  <h4 className="text-xs font-medium text-retro-fg">Queue Clear</h4>
                  <p className="text-xs text-retro-muted">No reported posts are currently pending review.</p>
                </div>
              ) : currentRealItem ? (
                <div className="relative rounded-lg border border-retro-border overflow-hidden bg-surface-interactive p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-retro-body">{currentRealItem.author_name}</span>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-rose-500/10 text-rose-400">
                      {currentRealItem.reason}
                    </span>
                  </div>

                  <div className="w-full h-44 rounded-lg bg-surface-elevated overflow-hidden flex items-center justify-center relative">
                    <ObjectImage contentUrl={currentRealItem.url} identity={identity ?? null} alt="" className="w-full h-full object-cover" />
                  </div>

                  {currentRealItem.caption && (
                    <p className="text-xs text-retro-muted line-clamp-1">{currentRealItem.caption}</p>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleRealDecision('flag_sensitive')}
                      className="py-2.5 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/15 text-rose-400 border border-rose-500/20 font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <EyeOff className="w-4 h-4" />
                      <span>Flag &amp; Hide</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRealDecision('approve')}
                      className="py-2.5 px-3 rounded-lg bg-retro-online/10 hover:bg-retro-online/15 text-retro-online border border-retro-online/20 font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Dismiss</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* ─── MODAL: Allocate Earned Likes to a Post ─── */}
      {showAllocateLikesModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface-raised rounded-lg p-5 max-w-sm w-full border border-retro-border shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-retro-accent">
              <Heart className="w-5 h-5 fill-retro-accent text-retro-accent" />
              <h4 className="text-sm font-medium text-retro-fg">Allocate {earnedLikes} Likes</h4>
            </div>

            <p className="text-xs text-retro-muted">
              Choose a post from the timeline to boost:
            </p>

            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {feedPosts.filter((p) => p && p.id && !p.is_sponsored).map((post) => (
                <div
                  key={post.id}
                  onClick={() => setSelectedTargetPostId(post.id)}
                  className={`p-2 rounded-lg border flex items-center gap-3 cursor-pointer transition-colors ${selectedTargetPostId === post.id ? 'border-retro-accent bg-surface-interactive' : 'border-retro-border hover:bg-surface-interactive'
                    }`}
                >
                  <div className="w-10 h-10 rounded bg-surface-elevated overflow-hidden shrink-0">
                    {post.url ? <ObjectImage contentUrl={post.url} identity={identity ?? null} alt="" className="w-full h-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-retro-body block truncate">{post.author_name}</span>
                    <span className="text-[11px] text-retro-muted truncate block">{post.caption || 'No caption'}</span>
                  </div>
                  <span className="text-xs text-retro-muted">{post.like_count || 0} likes</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-retro-border">
              <button
                type="button"
                onClick={() => setShowAllocateLikesModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-retro-muted hover:bg-surface-interactive cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedTargetPostId || isAllocatingLikes}
                onClick={handleAllocateLikes}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-retro-accent hover:bg-retro-accent-hover disabled:opacity-50 text-black cursor-pointer flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isAllocatingLikes ? 'Sending...' : 'Send Likes'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Real Moderation Terms & Caution Agreement ─── */}
      {showAgreementModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface-raised rounded-lg p-6 max-w-md w-full border border-retro-border shadow-xl space-y-4">
            <div className="flex items-center gap-2.5 text-retro-accent">
              <ShieldAlert className="w-5 h-5" />
              <h4 className="text-sm font-medium text-retro-fg">Moderator Code of Conduct</h4>
            </div>

            <div className="p-3 bg-retro-warning/5 rounded-lg border border-retro-warning/20 text-xs text-retro-fg space-y-1.5 leading-relaxed">
              <div className="flex items-center gap-1.5 font-medium text-retro-warning">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Content Responsibility</span>
              </div>
              <p className="text-[11px]">
                As a community moderator, you will inspect reported content. Flagged posts are automatically hidden from the platform.
              </p>
              <p className="text-[11px] font-medium">
                You are responsible for fair, unbiased enforcement.
              </p>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-surface-interactive">
              <input
                type="checkbox"
                checked={agreementChecked}
                onChange={(e) => setAgreementChecked(e.target.checked)}
                className="w-4 h-4 rounded accent-retro-accent"
              />
              <span className="text-xs font-medium text-retro-body">
                I accept the moderator terms and responsibility.
              </span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-retro-border">
              <button
                type="button"
                onClick={() => setShowAgreementModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-retro-muted hover:bg-surface-interactive cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!agreementChecked}
                onClick={() => {
                  setSignedDeal(true);
                  setShowAgreementModal(false);
                  loadRealQueue();
                }}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-retro-accent hover:bg-retro-accent-hover disabled:opacity-50 text-black cursor-pointer"
              >
                Sign &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
