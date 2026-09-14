"use client";

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Heart, X, Loader2 } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import { orbitFetch } from '../../utils/api';
import { playPress } from '../../utils/sounds';
import { resolveMediaUrl } from '../../utils/media';

export interface LikerUser {
  user_id: string;
  display_name: string;
  pfp_url?: string | null;
}

interface PostLikersModalProps {
  postId: string;
  isOpen: boolean;
  onClose: () => void;
  identity: OrbitIdentity | null;
  profilePics?: Record<string, string>;
  onSelectUser?: (userId: string) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  /** Stacking override for likers opened above higher-z overlays. */
  zIndexClass?: string;
}

export function PostLikersModal({
  postId,
  isOpen,
  onClose,
  identity,
  profilePics = {},
  onSelectUser,
  toast,
  zIndexClass = 'z-[var(--z-modal)]',
}: PostLikersModalProps) {
  const [likers, setLikers] = useState<LikerUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !postId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    orbitFetch(`/api/posts/${postId}/likers`, {}, identity)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        setLikers(Array.isArray(data?.likers) ? data.likers : []);
      })
      .catch((_err) => {
        if (cancelled) return;
        setError('Failed to load likes');
        toast?.('Could not load likers list', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [postId, isOpen, identity, toast]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleUserClick = (userId: string) => {
    playPress(750);
    onClose();
    onSelectUser?.(userId);
  };

  const modalContent = (
    <div
      className={`fixed inset-0 ${zIndexClass} bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-orbit-fade-in`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Post likes"
    >
      <div
        className="bg-surface-raised w-full max-w-sm rounded-t-3xl sm:rounded-2xl border border-border-glass shadow-2xl overflow-hidden flex flex-col max-h-[80vh] sm:max-h-[500px] animate-orbit-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border-glass flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
            <h3 className="text-sm font-extrabold text-retro-fg">Likes</h3>
            {!loading && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-glass-w12 text-retro-muted border border-border-glass">
                {likers.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              playPress(700);
              onClose();
            }}
            aria-label="Close"
            className="p-1 rounded-full text-retro-muted hover:text-retro-fg cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Likers List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-retro-muted">
              <Loader2 className="w-6 h-6 animate-spin text-retro-fg" />
              <span className="text-xs">Loading likes...</span>
            </div>
          ) : error ? (
            <div className="py-10 text-center text-xs text-rose-400 space-y-2">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  orbitFetch(`/api/posts/${postId}/likers`, {}, identity)
                    .then(async (res) => {
                      if (!res.ok) throw new Error();
                      const data = await res.json();
                      setLikers(Array.isArray(data?.likers) ? data.likers : []);
                    })
                    .catch(() => setError('Failed to load likes'))
                    .finally(() => setLoading(false));
                }}
                className="px-3 py-1 bg-glass-w12 border border-border-glass rounded text-retro-fg hover:bg-glass-w20 cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : likers.length === 0 ? (
            <div className="py-12 text-center text-xs text-retro-muted italic">
              No likes yet.
            </div>
          ) : (
            likers.map((liker) => {
              // Live cache first (post-upload server ref), server echo second:
              // profilePics is synced from loadUsers on every boot + save.
              const avatar = profilePics[liker.user_id] || liker.pfp_url;
              return (
                <div
                  key={liker.user_id}
                  onClick={() => handleUserClick(liker.user_id)}
                  className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-glass-w12 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-glass-w20 border border-border-glass overflow-hidden shrink-0 flex items-center justify-center">
                      {avatar ? (
                        <img
                          src={resolveMediaUrl(avatar)}
                          alt={liker.display_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-xs font-bold text-retro-fg">
                          {liker.display_name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col min-w-0 text-left">
                      <span className="text-xs font-semibold text-retro-fg truncate group-hover:underline">
                        {liker.display_name}
                      </span>
                      <span className="text-[10px] text-retro-muted font-mono truncate">
                        @{liker.user_id.slice(0, 14)}...
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] font-medium text-retro-muted group-hover:text-retro-fg shrink-0 transition-colors px-2 py-1 rounded bg-glass-w06">
                    View
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
}
