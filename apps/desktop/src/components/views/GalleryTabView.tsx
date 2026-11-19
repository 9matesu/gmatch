"use client";

// Extracted verbatim from App.tsx `mainView === 'gallery'` branch
// (GalleryView + the DeckBuilder block that lives on the same page).
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject } from '@orbit/shared';
import { GalleryView, type GalleryViewProps } from '../GalleryView';
import { DeckBuilder } from '../games/DeckBuilder';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

export function GalleryTabView({
  subTab,
  setSubTab,
  allOwnedCards,
  onEnterArena,
  identity,
  toast,
  ...galleryProps
}: {
  subTab: 'cards' | 'deck';
  setSubTab: (t: 'cards' | 'deck') => void;
  allOwnedCards: OrbitObject[];
  onEnterArena: () => void;
  identity: OrbitIdentity;
  toast: ToastFn;
} & Pick<
  GalleryViewProps,
  | 'filteredItems'
  | 'itemsLoading'
  | 'galleryFilter'
  | 'setGalleryFilter'
  | 'gallerySort'
  | 'setGallerySort'
  | 'cardSearch'
  | 'setCardSearch'
  | 'cardTypeFilter'
  | 'setCardTypeFilter'
  | 'galleryPage'
  | 'setGalleryPage'
  | 'selectedGalleryIds'
  | 'setSelectedGalleryIds'
  | 'totalPages'
  | 'paginatedItems'
  | 'batchDownloading'
  | 'handleDownloadAll'
  | 'handleBatchDownload'
  | 'handleBatchDelete'
  | 'dragActive'
  | 'setDragActive'
  | 'dragAnchorId'
  | 'setDragAnchorId'
  | 'onOpenCreateCard'
  | 'onCreateCardFromMedia'
  | 'onItemContextMenu'
  | 'onSetWallpaper'
  | 'users'
  | 'setExpandedItemId'
  | 'posts'
  | 'cardByMedia'
  | 'onOpenOwnerProfile'
  | 'onRepostGalleryImage'
  | 'onAddGalleryImageToStory'
>) {
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
          ? 'bg-surface-interactive text-retro-fg border-edge'
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
          <GalleryView {...galleryProps} identity={identity} toast={toast} />
        </div>
      ) : (
        <div role="tabpanel" id="gallery-panel-deck" aria-labelledby="gallery-tab-deck" className="solid-panel border border-edge rounded-xl p-4">
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
