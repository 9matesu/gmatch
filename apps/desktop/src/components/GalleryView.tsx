"use client";

import { useState } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { User, OrbitObject } from '@orbit/shared';
import { CardTile } from './home/CardTile';
import { CardSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { DropZone } from './DropZone';
import { CardDetailView } from './CardDetailView';
import { SlideshowManager } from './slideshows/SlideshowManager';
import type { FeedPost } from './feed/GoonMatchFeed';
import { Layers, Download, Trash2, CheckSquare, Search, Film, ImagePlus } from 'lucide-react';

export interface GalleryViewProps {
  filteredItems: OrbitObject[];
  itemsLoading: boolean;
  galleryFilter: 'all' | 'received' | 'sent' | 'starred';
  setGalleryFilter: (f: 'all' | 'received' | 'sent' | 'starred') => void;
  gallerySort: 'newest' | 'oldest' | 'likes' | 'score';
  setGallerySort: (s: 'newest' | 'oldest' | 'likes' | 'score') => void;
  cardSearch: string;
  setCardSearch: (v: string) => void;
  cardTypeFilter: 'all' | 'image' | 'video';
  setCardTypeFilter: (v: 'all' | 'image' | 'video') => void;
  galleryPage: number;
  setGalleryPage: React.Dispatch<React.SetStateAction<number>>;
  selectedGalleryIds: Set<string>;
  setSelectedGalleryIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  totalPages: number;
  paginatedItems: OrbitObject[];
  batchDownloading: boolean;
  handleDownloadAll: () => Promise<void>;
  handleBatchDownload: () => Promise<void>;
  handleBatchDelete: () => Promise<void>;
  dragActive: boolean;
  setDragActive: (v: boolean) => void;
  dragAnchorId: string | null;
  setDragAnchorId: (id: string | null) => void;
  users: User[];
  identity: OrbitIdentity;
  setExpandedItemId: (id: string | null) => void;
  posts?: FeedPost[];
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  cardByMedia?: ReadonlyMap<string, string>;
  onOpenOwnerProfile?: (ownerId: string) => void;
  onOpenProfile?: (userId: string) => void;
  onOpenCreateCard?: () => void;
}

export function GalleryView({
  filteredItems,
  itemsLoading,
  galleryFilter,
  setGalleryFilter,
  gallerySort,
  setGallerySort,
  cardSearch,
  setCardSearch,
  cardTypeFilter,
  setCardTypeFilter,
  galleryPage,
  setGalleryPage,
  selectedGalleryIds,
  setSelectedGalleryIds,
  totalPages,
  paginatedItems,
  batchDownloading,
  handleDownloadAll,
  handleBatchDownload,
  handleBatchDelete,
  dragActive,
  setDragActive,
  dragAnchorId,
  setDragAnchorId,
  users,
  identity,
  setExpandedItemId,
  posts = [],
  toast,
  cardByMedia,
  onOpenOwnerProfile,
  onOpenProfile,
  onOpenCreateCard,
}: GalleryViewProps) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showSlideshows, setShowSlideshows] = useState(false);

  return (
    <>
    <div id="gallery-section" className="space-y-4 font-sans select-none">
      <div className="bg-surface-raised border border-border-glass rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-border-glass bg-surface-raised flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-surface-interactive border border-border-glass flex items-center justify-center text-retro-muted">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-retro-fg uppercase tracking-wider">
                Cards Collection ({filteredItems.length})
              </h2>
              <p className="text-[10px] text-retro-muted">Your unlocked deck, received trades, and favorites</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-xs">
            <div className="flex bg-surface-interactive p-0.5 rounded-lg border border-border-glass text-[11px] font-semibold">
              {(['all', 'received', 'sent', 'starred'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setGalleryFilter(t)
                    setGalleryPage(0)
                  }}
                  className={`px-2.5 py-1 rounded-md cursor-pointer uppercase transition-colors ${
                    galleryFilter === t ? 'bg-surface-raised text-retro-fg font-bold shadow-sm' : 'text-retro-muted hover:text-retro-body'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-surface-interactive px-2 py-1 rounded-lg border border-border-glass text-[11px]">
              <span className="text-retro-muted font-semibold text-[10px] uppercase">Sort:</span>
              <select
                value={gallerySort}
                onChange={(e) => {
                  setGallerySort(e.target.value as any)
                  setGalleryPage(0)
                }}
                className="bg-transparent text-retro-body text-[11px] font-semibold outline-none cursor-pointer"
              >
                <option value="newest" className="bg-surface-raised text-retro-body">Newest</option>
                <option value="oldest" className="bg-surface-raised text-retro-body">Oldest</option>
                <option value="likes" className="bg-surface-raised text-retro-body">Most Likes</option>
                <option value="score" className="bg-surface-raised text-retro-body">Highest XP</option>
              </select>
            </div>

            <div className="flex items-center gap-1 bg-surface-interactive px-2 py-1 rounded-lg border border-border-glass text-[11px]">
              <Search className="w-3.5 h-3.5 text-retro-muted" />
              <input
                type="text"
                value={cardSearch}
                onChange={(e) => { setCardSearch(e.target.value); setGalleryPage(0) }}
                placeholder="Filter cards…"
                className="bg-transparent text-retro-body text-[11px] font-semibold outline-none placeholder:text-retro-muted w-24 sm:w-32"
              />
            </div>

            <div className="flex bg-surface-interactive p-0.5 rounded-lg border border-border-glass text-[11px] font-semibold">
              {(['all', 'image', 'video'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setCardTypeFilter(t); setGalleryPage(0) }}
                  className={`px-2.5 py-1 rounded-md cursor-pointer uppercase transition-colors ${
                    cardTypeFilter === t ? 'bg-surface-raised text-retro-fg font-bold shadow-sm' : 'text-retro-muted hover:text-retro-body'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={batchDownloading || filteredItems.length === 0}
              onClick={handleDownloadAll}
              className="px-3 py-1 bg-surface-raised hover:bg-surface-interactive text-retro-body border border-border-glass rounded-lg font-semibold text-[11px] flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors shadow-sm"
              title="Download all cards in current filter"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{batchDownloading ? 'Saving...' : 'Download All'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSlideshows((v) => !v)}
              className={`px-3 py-1 border rounded-lg font-semibold text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm ${
                showSlideshows ? 'bg-surface-interactive text-retro-fg border-zinc-600' : 'bg-surface-raised hover:bg-surface-interactive text-retro-body border-border-glass'
              }`}
              title="Create and play slideshows"
            >
              <Film className="w-3.5 h-3.5" />
              <span>Slideshows</span>
            </button>
          </div>
        </div>

        {selectedGalleryIds.size > 0 && (
          <div className="px-4 py-2.5 bg-surface-raised border-b border-border-glass flex items-center justify-between gap-3 text-xs animate-orbit-fade-in">
            <div className="flex items-center gap-2 text-retro-fg font-bold">
              <CheckSquare className="w-4 h-4 text-emerald-600" />
              <span>{selectedGalleryIds.size} cards selected</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBatchDownload}
                className="px-3 py-1 bg-black hover:bg-surface-elevated text-white font-bold text-[11px] rounded-md transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Selected</span>
              </button>
              <button
                type="button"
                onClick={handleBatchDelete}
                className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold text-[11px] rounded-md transition-colors cursor-pointer flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedGalleryIds(new Set())}
                className="text-[11px] text-retro-muted hover:text-retro-body px-2 py-1 cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="p-4 border-b border-border-glass bg-surface-canvas/60 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-retro-body">
            <span className="flex items-center gap-1.5 text-retro-fg">
              <Layers className="w-4 h-4 text-retro-muted" />
              <span>Add Media to Card Collection</span>
            </span>
            <span className="text-[10px] text-retro-muted font-normal">All cards must be created through the Card Forge</span>
          </div>
          <button
            type="button"
            onClick={onOpenCreateCard}
            className="w-full sm:w-auto px-4 py-2 bg-retro-accent text-black font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer shadow-md hover:bg-retro-accent-hover flex items-center gap-2"
          >
            <ImagePlus className="w-3.5 h-3.5" />
            <span>Create Card</span>
          </button>
        </div>

        <div className="p-4">
          {itemsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
              {Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : filteredItems.length === 0 ? (
            <EmptyState title="No cards found" description="Upload images, battle in the duel arena, or open lootboxes to expand your deck!" />
          ) : (
            <>
              <div
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5 select-none"
                onMouseDown={() => setDragActive(true)}
                onMouseUp={() => { setDragActive(false); setDragAnchorId(null) }}
                onMouseLeave={() => { setDragActive(false); setDragAnchorId(null) }}
                onMouseMove={(e) => {
                  if (!dragActive && e.buttons !== 0) setDragActive(true)
                }}
              >
                {paginatedItems.map(item => (
                  <CardTile
                    key={item.id}
                    item={item as any}
                    dragActive={dragActive}
                    selected={selectedGalleryIds.has(item.id)}
                    onClick={() => {
                      const cardId = cardByMedia?.get(item.id)
                      if (cardId) setSelectedCardId(cardId)
                    }}
                    onDoubleClick={() => setExpandedItemId(item.id)}
                    onSelect={(id) => {
                      if (dragAnchorId) {
                        const ids = paginatedItems.map(i => i.id)
                        const ai = ids.indexOf(dragAnchorId)
                        const bi = ids.indexOf(id)
                        if (ai > -1 && bi > -1) {
                          const lo = Math.min(ai, bi)
                          const hi = Math.max(ai, bi)
                          const next = new Set<string>(selectedGalleryIds)
                          for (let i = lo; i <= hi; i++) next.add(ids[i])
                          setSelectedGalleryIds(next)
                          setDragAnchorId(id)
                          return
                        }
                      }
                      setDragAnchorId(id)
                      setSelectedGalleryIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(id)) next.delete(id)
                        else next.add(id)
                        return next
                      })
                    }}
                    users={users}
                    identity={identity}
                    onOpenOwnerProfile={onOpenOwnerProfile}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-border-glass/80 mt-4 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedGalleryIds.size === paginatedItems.length) setSelectedGalleryIds(new Set())
                    else setSelectedGalleryIds(new Set(paginatedItems.map(i => i.id)))
                  }}
                  className="text-xs font-semibold text-retro-muted hover:text-retro-body cursor-pointer"
                >
                  {selectedGalleryIds.size === paginatedItems.length ? 'Deselect all on page' : 'Select all on page'}
                </button>

                {totalPages > 1 && (
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      disabled={galleryPage === 0}
                      onClick={() => {
                        setGalleryPage(p => Math.max(0, p - 1))
                        document.getElementById('gallery-section')?.scrollIntoView({ behavior: 'smooth' })
                      }}
                      className="px-2.5 py-1 text-xs font-semibold text-retro-muted border border-border-glass hover:bg-surface-interactive rounded-lg disabled:opacity-30 cursor-pointer transition-colors"
                    >
                      ← Prev
                    </button>
                    <span className="text-retro-muted font-mono text-[11px]">
                      Page <strong className="text-retro-body">{galleryPage + 1}</strong> of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={galleryPage >= totalPages - 1}
                      onClick={() => {
                        setGalleryPage(p => Math.min(totalPages - 1, p + 1))
                        document.getElementById('gallery-section')?.scrollIntoView({ behavior: 'smooth' })
                      }}
                      className="px-2.5 py-1 text-xs font-semibold text-retro-muted border border-border-glass hover:bg-surface-interactive rounded-lg disabled:opacity-30 cursor-pointer transition-colors"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>

    {showSlideshows && (
      <SlideshowManager
        identity={identity}
        cards={filteredItems}
        posts={posts}
        toast={toast}
      />
    )}

    {selectedCardId && (
      <CardDetailView
        cardId={selectedCardId}
        identity={identity}
        onClose={() => setSelectedCardId(null)}
        onOpenProfile={onOpenProfile}
      />
    )}
    </>
  );
}
