"use client";

import type { OrbitIdentity } from '@orbit/crypto';
import type { User, OrbitObject } from '@orbit/shared';

interface ContextMenuState {
  x: number;
  y: number;
  type: 'user' | 'item';
  data: any;
}

interface ContextOverlayProps {
  contextMenu: ContextMenuState | null;
  onDismiss: () => void;
  identity: OrbitIdentity | null;
  friendsIds: string[];
  toast: (text: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  onViewProfile: (user: User) => void;
  onToggleContact: (id: string) => void;
  onSendCard: (userId: string) => void;
  onCopyId: (id: string) => void;
  onSendPm: (user: User) => void;
  onBlockUser: (id: string) => void;
  onOpenLightbox: (id: string) => void;
  onDownloadItem: (item: OrbitObject) => void;
  onCopyImageLink: (id: string) => void;
  onToggleFavorite: (item: OrbitObject) => Promise<boolean>;
  onDeleteItem: (item: OrbitObject) => void;
  onRemoveFromInbox: (item: OrbitObject) => void;
  onReportUser: (id: string, name: string, objectId?: string) => void;
  onReportItem: (ownerId: string, ownerName: string, objectId: string) => void;
}

export function ContextOverlay({
  contextMenu,
  onDismiss,
  identity,
  friendsIds,
  toast,
  onViewProfile,
  onToggleContact,
  onSendCard,
  onCopyId,
  onSendPm,
  onBlockUser,
  onOpenLightbox,
  onDownloadItem,
  onCopyImageLink,
  onToggleFavorite,
  onDeleteItem,
  onRemoveFromInbox,
  onReportUser,
  onReportItem,
}: ContextOverlayProps) {
  if (!contextMenu) return null;

  return (
    <div
      className="fixed inset-0 z-[200]"
      onClick={onDismiss}
      onContextMenu={(e) => { e.preventDefault(); onDismiss() }}
    >
      <div
        className="fixed bg-retro-panel border border-retro-border p-1.5 w-48 text-xs z-[210] space-y-0.5"
        style={{ top: Math.min(contextMenu.y, window.innerHeight - 180), left: Math.min(contextMenu.x, window.innerWidth - 200) }}
        onClick={e => e.stopPropagation()}
      >
        {contextMenu.type === 'user' && (
          <>
            <button
              type="button"
              onClick={() => {
                onViewProfile(contextMenu.data)
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-fg transition-colors font-bold"
            >
              View Full Profile
            </button>
            <button
              type="button"
              onClick={() => {
                onToggleContact(contextMenu.data.id)
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-fg flex items-center justify-between transition-colors font-bold"
            >
              <span>{friendsIds.includes(contextMenu.data.id) ? 'Remove Contact' : 'Add Contact'}</span>
              <span className="text-[10px] text-retro-accent">★</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onSendCard(contextMenu.data.id)
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-accent font-bold transition-colors"
            >
              Send Image
            </button>
            <button
              type="button"
              onClick={() => {
                onCopyId(contextMenu.data.id)
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-muted transition-colors"
            >
              Copy GoonMatch ID
            </button>
            <button
              type="button"
              onClick={() => {
                onSendPm(contextMenu.data)
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-purple-300 font-bold transition-colors"
            >
              Send PM
            </button>
            <button
              type="button"
              onClick={() => {
                onBlockUser(contextMenu.data.id)
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-warning transition-colors"
            >
              Block User
            </button>
            <button
              type="button"
              onClick={() => {
                onReportUser(contextMenu.data.id, contextMenu.data.display_name?.trim() || 'Unknown User')
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-error font-bold transition-colors"
            >
              Report User
            </button>
          </>
        )}

        {contextMenu.type === 'item' && (
          <>
            <button
              type="button"
              onClick={() => {
                onOpenLightbox(contextMenu.data.id)
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-fg transition-colors font-bold"
            >
              Open Lightbox
            </button>
            <button
              type="button"
              onClick={() => {
                onDownloadItem(contextMenu.data)
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-fg transition-colors"
            >
              Download Image
            </button>
            <button
              type="button"
              onClick={() => {
                onCopyImageLink(contextMenu.data.id)
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-fg transition-colors"
            >
              Copy Image Link
            </button>
            <button
              type="button"
              onClick={async () => {
                const ok = await onToggleFavorite(contextMenu.data)
                if (ok) toast('Updated starred status', 'success')
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-accent transition-colors"
            >
              Star / Favorite
            </button>
            {contextMenu.data.owner_id === identity?.orbitId ? (
              <button
                type="button"
                onClick={() => {
                  onDeleteItem(contextMenu.data)
                  onDismiss()
                }}
                className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-error transition-colors"
              >
                Delete Image
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onRemoveFromInbox(contextMenu.data)
                  onDismiss()
                }}
                className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-warning transition-colors"
              >
                Remove from Inbox
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (contextMenu.data.owner_id) {
                  onReportItem(contextMenu.data.owner_id, contextMenu.data.owner_name?.trim() || 'Unknown User', contextMenu.data.id)
                }
                onDismiss()
              }}
              className="w-full text-left px-3 py-2 hover:bg-retro-bg text-retro-error font-bold transition-colors"
            >
              Report Image
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface ReportModalProps {
  reportModal: { id: string; name: string; objectId?: string } | null;
  onClose: () => void;
  onSubmit: (id: string, opts?: { objectId?: string }) => void;
  reportReason: string;
  setReportReason: (v: string) => void;
  reportCategory: 'spam' | 'harassment' | 'inappropriate' | 'abuse';
  setReportCategory: (v: 'spam' | 'harassment' | 'inappropriate' | 'abuse') => void;
}

export function ReportModal({
  reportModal,
  onClose,
  onSubmit,
  reportReason,
  setReportReason,
  reportCategory,
  setReportCategory,
}: ReportModalProps) {
  if (!reportModal) return null;

  return (
    <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-retro-panel border border-retro-error max-w-sm w-full p-5 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-retro-error uppercase tracking-wider">
          Report User: {reportModal.name}
        </h3>
        {reportModal.objectId && (
          <p className="text-[10px] text-retro-muted font-sans truncate" title={reportModal.objectId}>
            Attached evidence: {reportModal.objectId}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {(['inappropriate', 'harassment', 'spam', 'abuse'] as const).map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setReportCategory(cat)}
              className={`px-3 py-1 border font-bold uppercase transition-colors ${
                reportCategory === cat
                  ? 'bg-retro-accent text-black border-retro-accent'
                  : 'bg-retro-bg text-retro-muted border-retro-border hover:text-retro-fg'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <textarea
          rows={3}
          value={reportReason}
          onChange={e => setReportReason(e.target.value)}
          placeholder="Describe the issue (optional)..."
          className="w-full p-2.5 bg-retro-bg border border-retro-border text-xs text-retro-fg placeholder:text-retro-muted focus:outline-none"
          maxLength={200}
        />
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onSubmit(reportModal.id, { objectId: reportModal.objectId })}
            className="flex-1 bg-retro-error hover:bg-retro-red text-white font-bold py-2 text-xs transition-colors"
          >
            Submit Report & Block
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs text-retro-muted hover:text-retro-fg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
