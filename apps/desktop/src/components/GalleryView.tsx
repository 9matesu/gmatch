"use client";

import { useState, useMemo, useEffect } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { User, OrbitObject } from '@orbit/shared';
import { CardTile } from './home/CardTile';
import { CardSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { CardDetailView } from './CardDetailView';
import { SlideshowManager } from './slideshows/SlideshowManager';
import IdleGalleryView from './grid/IdleGalleryView';
import { useGame } from '@/game/store';
import type { FeedPost } from './feed/GMatchFeed';
import { Layers, Download, Trash2, CheckSquare, Search, Film, ImagePlus, ImageIcon, Tag } from 'lucide-react';
import { DND_KEEPSAKE } from './DropZone';

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
  onCreateCardFromMedia?: (media: { url: string; tags: string[]; name: string }) => void;
  /** Right-click on a collection card → shared context menu. */
  onItemContextMenu?: (e: React.MouseEvent, item: OrbitObject) => void;
  onSetWallpaper?: (url: string) => void;
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
  onCreateCardFromMedia,
  onItemContextMenu,
  onSetWallpaper,
}: GalleryViewProps) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedGalleryIds(new Set()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSelectedGalleryIds])
  const [showSlideshows, setShowSlideshows] = useState(false);
  const [dndCardHover, setDndCardHover] = useState(false);
  const idleKeepsakes = useGame((s) => s.gallery);

  // Tag pills: union of tags on the visible collection, most frequent first.
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of filteredItems) {
      const tags = (item as { tags?: string[] }).tags;
      if (Array.isArray(tags)) for (const t of tags) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [filteredItems]);
  const toggleTag = (t: string) => setActiveTags(prev => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });
  const shownItems = activeTags.size === 0
    ? paginatedItems
    : filteredItems.filter((item) => {
        const tags = (item as { tags?: string[] }).tags;
        return Array.isArray(tags) && [...activeTags].every((t) => tags.includes(t));
      });

  return (
    <>
    <div id="gallery-section" className="space-y-4 font-sans select-none">
      {idleKeepsakes.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="glass-header p-4 flex items-center gap-2">
            <div className="glass-inset w-7 h-7 rounded-lg flex items-center justify-center text-retro-muted">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-retro-fg uppercase tracking-wider">
                Gallery ({idleKeepsakes.length})
              </h2>
              <p className="text-[10px] text-retro-muted">Idle spoils from the Grid — view them, set a backdrop, or turn them into cards</p>
            </div>
          </div>
          <IdleGalleryView onCreateCard={onCreateCardFromMedia} onSetWallpaper={onSetWallpaper} />
        </div>
      )}
      <div className="glass-card overflow-hidden">
        <div className="glass-header p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="glass-inset w-7 h-7 rounded-lg flex items-center justify-center text-retro-muted">
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
            <div className="glass-inset flex p-0.5 rounded-lg text-xs font-semibold">
              {(['all', 'received', 'sent', 'starred'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setGalleryFilter(t)
                    setGalleryPage(0)
                  }}
                  className={`px-2.5 py-1 rounded-md cursor-pointer uppercase tracking-wider transition-colors ${
                    galleryFilter === t ? 'bg-white/14 text-retro-fg font-bold shadow-sm' : 'text-retro-muted hover:text-retro-body'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="glass-field flex items-center gap-1 px-2 py-1 text-xs">
              <span className="text-retro-muted font-semibold text-[10px] uppercase tracking-wider">Sort:</span>
              <select
                value={gallerySort}
                onChange={(e) => {
                  setGallerySort(e.target.value as any)
                  setGalleryPage(0)
                }}
                className="bg-transparent text-retro-body text-xs font-semibold outline-none cursor-pointer"
              >
                <option value="newest" className="bg-surface-raised text-retro-body">Newest</option>
                <option value="oldest" className="bg-surface-raised text-retro-body">Oldest</option>
                <option value="likes" className="bg-surface-raised text-retro-body">Most Likes</option>
                <option value="score" className="bg-surface-raised text-retro-body">Highest XP</option>
              </select>
            </div>

            <div className="glass-field flex items-center gap-1 px-2 py-1 text-xs">
              <Search className="w-3.5 h-3.5 text-retro-muted" />
              <input
                type="text"
                value={cardSearch}
                onChange={(e) => { setCardSearch(e.target.value); setGalleryPage(0) }}
                placeholder="Filter cards…"
                className="bg-transparent text-retro-body text-xs font-semibold outline-none placeholder:text-retro-muted w-24 sm:w-32"
              />
            </div>

            <div className="glass-inset flex p-0.5 rounded-lg text-xs font-semibold">
              {(['all', 'image', 'video'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setCardTypeFilter(t); setGalleryPage(0) }}
                  className={`px-2.5 py-1 rounded-md cursor-pointer uppercase tracking-wider transition-colors ${
                    cardTypeFilter === t ? 'bg-white/14 text-retro-fg font-bold shadow-sm' : 'text-retro-muted hover:text-retro-body'
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
              className="glass-action px-3 py-1 rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              title="Download all cards in current filter"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{batchDownloading ? 'Saving...' : 'Download All'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSlideshows((v) => !v)}
              className={`glass-action ${showSlideshows ? 'glass-nav-active' : ''} px-3 py-1 rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer`}
              title="Create and play slideshows"
            >
              <Film className="w-3.5 h-3.5" />
              <span>Slideshows</span>
            </button>
          </div>
        </div>

        {selectedGalleryIds.size > 0 && (
          <div className="glass-header px-4 py-2.5 flex items-center justify-between gap-3 text-xs animate-orbit-fade-in">
            <div className="flex items-center gap-2 text-retro-fg font-bold">
              <CheckSquare className="w-4 h-4 text-emerald-600" />
              <span>{selectedGalleryIds.size} cards selected</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBatchDownload}
                className="glass-action glass-action-primary px-3 py-1.5 rounded-lg font-bold text-xs cursor-pointer flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Selected</span>
              </button>
              <button
                type="button"
                onClick={handleBatchDelete}
                className="glass-action glass-action-danger px-3 py-1.5 rounded-lg font-bold text-xs cursor-pointer flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedGalleryIds(new Set())}
                className="text-xs text-retro-muted hover:text-retro-body px-2 py-1 cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="p-4 border-b border-white/10 bg-glass-w5 space-y-2">
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
            onDragOver={(e) => { if (onCreateCardFromMedia) { e.preventDefault(); setDndCardHover(true) } }}
            onDragLeave={() => setDndCardHover(false)}
            onDrop={(e) => {
              if (!onCreateCardFromMedia) return
              e.preventDefault()
              setDndCardHover(false)
              try {
                const raw = e.dataTransfer.getData(DND_KEEPSAKE)
                if (raw) onCreateCardFromMedia(JSON.parse(raw))
              } catch { /* malformed payload — ignore */ }
            }}
            className={`glass-action glass-action-primary w-full sm:w-auto px-4 py-2 font-bold text-xs uppercase tracking-wider rounded-lg cursor-pointer flex items-center gap-2 ${dndCardHover ? 'ring-2 ring-retro-accent' : ''}`}
          >
            <ImagePlus className="w-3.5 h-3.5" />
            <span>{dndCardHover ? 'Drop to forge card' : 'Create Card'}</span>
          </button>
        </div>

      </div>

      <div className="glass-card p-4">
          {tagCounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pb-3 -mt-1">
              <Tag className="w-3.5 h-3.5 text-retro-muted" />
              {tagCounts.map(([t, n]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  aria-pressed={activeTags.has(t)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border cursor-pointer transition-colors ${activeTags.has(t) ? 'bg-glass-w20 border-retro-fg/70' : 'border-white/10 text-retro-muted hover:text-retro-body'}`}
                >
                  {t} <span className="opacity-60">{n}</span>
                </button>
              ))}
              {activeTags.size > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTags(new Set())}
                  className="text-[10px] text-retro-muted hover:text-retro-fg cursor-pointer underline"
                >
                  clear ({activeTags.size})
                </button>
              )}
            </div>
          )}
          {itemsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : filteredItems.length === 0 ? (
            <EmptyState title="No cards found" description="Upload images, battle in the duel arena, or open lootboxes to expand your deck!" />
          ) : (
            <>
              <div
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 select-none"
                onMouseDown={() => setDragActive(true)}
                onMouseUp={() => { setDragActive(false); setDragAnchorId(null) }}
                onMouseLeave={() => { setDragActive(false); setDragAnchorId(null) }}
                onMouseMove={(e) => {
                  if (!dragActive && e.buttons !== 0) setDragActive(true)
                }}
              >
                {shownItems.map(item => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_KEEPSAKE, JSON.stringify({ url: `/api/objects/${item.id}`, tags: (item as { tags?: string[] }).tags || [], name: (item as { caption?: string }).caption || 'Card' }))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onContextMenu={(e) => { if (onItemContextMenu) { e.preventDefault(); onItemContextMenu(e, item) } }}
                  >
                    <CardTile
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
                  </div>
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
                      className="glass-action px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-30 cursor-pointer"
                    >
                      ← Prev
                    </button>
                    <span className="text-retro-muted font-mono text-xs">
                      Page <strong className="text-retro-body">{galleryPage + 1}</strong> of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={galleryPage >= totalPages - 1}
                      onClick={() => {
                        setGalleryPage(p => Math.min(totalPages - 1, p + 1))
                        document.getElementById('gallery-section')?.scrollIntoView({ behavior: 'smooth' })
                      }}
                      className="glass-action px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-30 cursor-pointer"
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
