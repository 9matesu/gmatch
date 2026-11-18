import { useState } from 'react';
import { Gift, Tag } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { CanonicalCard } from '../../utils/cardCollection';
import { transferCard } from '../../utils/cardCollection';
import { Modal, Button } from '../../ui/kit';

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
    <Modal title={`Gift a card to ${recipientName}`} onClose={onClose} maxWidth="max-w-lg">
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
                className="flex items-center justify-between p-3 rounded-lg bg-glass-w8 border border-border-glass hover:border-border-strong transition-colors"
              >
                <div className="flex flex-col gap-1 min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-retro-fg truncate">
                      {card.name || 'Untitled Card'}
                    </span>
                    <span className="text-2xs uppercase font-mono px-1.5 py-0.5 rounded bg-glass-w12 text-amber-400 border border-border-glass">
                      {card.rarity}
                    </span>
                  </div>
                  {card.tags && card.tags.length > 0 && (
                    <div className="flex items-center gap-1 overflow-hidden">
                      <Tag className="w-2.5 h-2.5 text-retro-muted shrink-0" />
                      <span className="text-2xs text-retro-muted truncate">
                        {card.tags.join(', ')}
                      </span>
                    </div>
                  )}
                </div>

                <Button
                  size="sm"
                  variant="primary"
                  disabled={Boolean(sendingId)}
                  onClick={() => handleSend(card)}
                >
                  <Gift className="w-3 h-3" />
                  <span>{isSending ? 'Sending…' : 'Send as gift'}</span>
                </Button>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
