"use client";

// Extracted verbatim from App.tsx `mainView === 'gallery'` branch
// (GalleryView + the DeckBuilder block that lives on the same page).
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject, User } from '@orbit/shared';
import { GalleryView } from '../GalleryView';
import { DeckBuilder } from '../games/DeckBuilder';
import type { FeedPost } from '../feed/GoonMatchFeed';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

export function GalleryTabView({
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
  users,
  identity,
  setExpandedItemId,
  posts,
  toast,
  cardByMedia,
  onOpenOwnerProfile,
  myCards,
  onEnterArena,
}: {
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
  users: User[];
  identity: OrbitIdentity;
  setExpandedItemId: (id: string | null) => void;
  posts: FeedPost[];
  toast: ToastFn;
  cardByMedia: ReadonlyMap<string, string>;
  onOpenOwnerProfile: (ownerId: string) => void;
  myCards: OrbitObject[];
  onEnterArena: () => void;
}) {
  return (
    <div className="space-y-4">
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
        users={users}
        identity={identity}
        setExpandedItemId={setExpandedItemId}
        posts={posts}
        toast={toast}
        cardByMedia={cardByMedia}
        onOpenOwnerProfile={onOpenOwnerProfile}
        onOpenProfile={onOpenOwnerProfile}
      />

      {/* Decks live on the same page as the card gallery */}
      <div className="bg-surface-raised border border-retro-border rounded-xl p-4">
        <DeckBuilder
          identity={identity}
          cards={myCards as any}
          onEnterArena={onEnterArena}
          toast={toast}
        />
      </div>
    </div>
  );
}
