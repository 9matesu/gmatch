import React, { useState } from 'react';
import { X, Gift, Sparkles, Tag } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { CanonicalCard } from '../../utils/cardCollection';
import { transferCard } from '../../utils/cardCollection';

interface SendCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipientId: string;
  recipientName: string;
  identity: OrbitIdentity | null;
  cards: CanonicalCard[];
  onSendCard?: (cardId: string, recipientId: string) => Promise<boolean | void>;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function SendCardModal({
  isOpen,
  onClose,
  recipientId,
  recipientName,
  identity,
  cards,
  onSendCard,
  toast,
}: SendCardModalProps) {
  const [sendingId, setSendingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const ownedCards = (cards || []).filter(
    (c) => !identity?.orbitId || c.ownerId === identity.orbitId
  );

  const handleSend = async (card: CanonicalCard) => {
    if (sendingId) return;
    setSendingId(card.id);
    try {
      if (onSendCard) {
        await onSendCard(card.id, recipientId);
      } else {
        const transferred = await transferCard(identity, card.id, recipientId);
        if (!transferred) throw new Error('Transfer failed');
      }
      toast?.(`Card "${card.name || 'Untitled'}" gifted to ${recipientName}!`, 'success');
      onClose();
    } catch {
      toast?.('Failed to gift card. Please try again.', 'error');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`Gift a Card to ${recipientName}`}
      className="fixed inset-0 z-[var(--z-system)] flex items-center justify-center bg-black/80 p-4 select-none font-sans"
    >
      <div
        className="relative max-w-lg w-full bg-retro-panel rounded-xl border border-border-glass shadow-2xl overflow-hidden p-5 flex flex-col gap-4 text-retro-fg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-glass pb-3">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-bold tracking-wide">
              Gift a Card to <span className="text-retro-fg underline">{recipientName}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-retro-muted hover:text-retro-fg p-1 rounded hover:bg-glass-w12 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-retro-muted">
          Select a card from your collection to send as a gift. The card will be permanently transferred to {recipientName}.
        </p>

        <div className="max-h-80 overflow-y-auto space-y-2 pr-1 styled-scrollbar">
          {ownedCards.length === 0 ? (
            <div className="py-8 text-center text-xs text-retro-muted border border-dashed border-border-glass rounded-lg">
              No cards in your collection to gift.
            </div>
          ) : (
            ownedCards.map((card) => {
              const isSending = sendingId === card.id;
              return (
                <div
                  key={card.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-glass-w12 border border-border-glass hover:border-zinc-500 transition-colors"
                >
                  <div className="flex flex-col gap-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-retro-fg truncate">
                        {card.name || 'Untitled Card'}
                      </span>
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-400 border border-border-glass">
                        {card.rarity}
                      </span>
                    </div>
                    {card.tags && card.tags.length > 0 && (
                      <div className="flex items-center gap-1 overflow-hidden">
                        <Tag className="w-2.5 h-2.5 text-retro-muted shrink-0" />
                        <span className="text-[10px] text-retro-muted truncate">
                          {card.tags.join(', ')}
                        </span>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={Boolean(sendingId)}
                    onClick={() => handleSend(card)}
                    className="shrink-0 py-1.5 px-3 rounded text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <Gift className="w-3 h-3" />
                    <span>{isSending ? 'Sending...' : 'Send as Gift'}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
