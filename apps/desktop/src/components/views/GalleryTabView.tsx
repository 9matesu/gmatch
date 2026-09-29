"use client";

// Extracted verbatim from App.tsx `mainView === 'gallery'` branch
// (GalleryView + the DeckBuilder block that lives on the same page).
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject, User } from '@orbit/shared';
import { GalleryView } from '../GalleryView';
import { DeckBuilder } from '../games/DeckBuilder';
import type { FeedPost } from '../feed/GMatchFeed';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

export function GalleryTabView({
  subTab,
  setSubTab,
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
  onOpenCreateCard,
  onCreateCardFromMedia,
  onItemContextMenu,
  onSetWallpaper,
  users,
  identity,
  setExpandedItemId,
  posts,
  toast,
  cardByMedia,
  onOpenOwnerProfile,
  allOwnedCards,
  onEnterArena,
  onRepostGalleryImage,
  onAddGalleryImageToStory,
}: {
  subTab: 'cards' | 'deck';
  setSubTab: (t: 'cards' | 'deck') => void;
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
  onOpenCreateCard: () => void;
  onCreateCardFromMedia?: (media: { url: string; tags: string[]; name: string }) => void;
  onItemContextMenu?: (e: React.MouseEvent, item: OrbitObject) => void;
  onSetWallpaper?: (url: string) => void;
  users: User[];
  identity: OrbitIdentity;
  setExpandedItemId: (id: string | null) => void;
  posts: FeedPost[];
  toast: ToastFn;
  cardByMedia: ReadonlyMap<string, string>;
  onOpenOwnerProfile: (ownerId: string) => void;
  allOwnedCards: OrbitObject[];
  onEnterArena: () => void;
  onRepostGalleryImage?: (media: { url: string; tags: string[]; name?: string; kind?: 'video' | 'image'; mimeType?: string }) => void;
  onAddGalleryImageToStory?: (media: { url: string; tags: string[]; name?: string; kind?: 'video' | 'image'; mimeType?: string }) => void;
}) {
  const tab = (id: 'cards' | 'deck', label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      id={`gallery-tab-${id}`}
      aria-selected={subTab === id}
      aria-controls={`gallery-panel-${id}`}
      tabIndex={subTab === id ? 0 : -1}
      onClick={() => setSubTab(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
        subTab === id
          ? 'bg-surface-interactive text-retro-fg border-border-glass'
          : 'bg-transparent text-retro-muted border-transparent hover:text-retro-fg'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="p-3 sm:p-4 max-w-6xl mx-auto w-full space-y-4">
      <div className="flex items-center gap-1" role="tablist" aria-label="Gallery & Cards">
        {tab('cards', 'Cards')}
        {tab('deck', 'Deck')}
      </div>

      {subTab === 'cards' ? (
        <div role="tabpanel" id="gallery-panel-cards" aria-labelledby="gallery-tab-cards">
          <GalleryView
            filteredItems={filteredItems}
            itemsLoading={itemsLoading}
            galleryFilter={galleryFilter}
            setGalleryFilter={setGalleryFilter}
            gallerySort={gallerySort}
            setGallerySort={setGallerySort}
            cardSearch={cardSearch}
            setCardSearch={setCardSearch}
            cardTypeFilter={cardTypeFilter}
            setCardTypeFilter={setCardTypeFilter}
            galleryPage={galleryPage}
            setGalleryPage={setGalleryPage}
            selectedGalleryIds={selectedGalleryIds}
            setSelectedGalleryIds={setSelectedGalleryIds}
            totalPages={totalPages}
            paginatedItems={paginatedItems}
            batchDownloading={batchDownloading}
            handleDownloadAll={handleDownloadAll}
            handleBatchDownload={handleBatchDownload}
            handleBatchDelete={handleBatchDelete}
            dragActive={dragActive}
            setDragActive={setDragActive}
            dragAnchorId={dragAnchorId}
            setDragAnchorId={setDragAnchorId}
            onOpenCreateCard={onOpenCreateCard}
            onCreateCardFromMedia={onCreateCardFromMedia}
            onItemContextMenu={onItemContextMenu}
            onSetWallpaper={onSetWallpaper}
            users={users}
            identity={identity}
            setExpandedItemId={setExpandedItemId}
            posts={posts}
            toast={toast}
            cardByMedia={cardByMedia}
            onOpenOwnerProfile={onOpenOwnerProfile}
            onOpenProfile={onOpenOwnerProfile}
            onRepostGalleryImage={onRepostGalleryImage}
            onAddGalleryImageToStory={onAddGalleryImageToStory}
          />
        </div>
      ) : (
        <div role="tabpanel" id="gallery-panel-deck" aria-labelledby="gallery-tab-deck" className="solid-panel border border-border-glass rounded-xl p-4">
          <DeckBuilder
            identity={identity}
            cards={allOwnedCards as any}
            onEnterArena={onEnterArena}
            toast={toast}
          />
        </div>
      )}
    </div>
  );
}
