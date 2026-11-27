import { useState } from 'react';
import { Gift, Tag } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { CanonicalCard } from '../../utils/cardCollection';
import { transferCard } from '../../utils/cardCollection';
import { Modal, Button } from '../../ui/kit';
import { classes, CHROME, COLOR, FEEDBACK, GAP, ICON, RECIPE, TYPE, WEIGHT } from '../../ui/tokens';

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
      <p className={FEEDBACK.description}>
        Select a card from your collection to send as a gift. The card will be permanently transferred to {recipientName}.
      </p>

      <div className="max-h-80 overflow-y-auto space-y-2 pr-1 styled-scrollbar">
        {ownedCards.length === 0 ? (
          <div className={classes(FEEDBACK.centerCompact, RECIPE.card, 'border-dashed')}>
            No cards in your collection to gift.
          </div>
        ) : (
          ownedCards.map((card) => {
            const isSending = sendingId === card.id;
            return (
              <div
                key={card.id}
                className={classes(CHROME.rowTile, 'flex items-center justify-between', 'hover:border-edge-strong')}
              >
                <div className={classes('flex flex-col min-w-0 pr-2', GAP[1])}>
                  <div className={classes('flex items-center', GAP[2])}>
                    <span className={classes(TYPE.body, WEIGHT.semibold, COLOR.fg, 'truncate')}>
                      {card.name || 'Untitled Card'}
                    </span>
                    <span className={classes(CHROME.warningPill, 'uppercase')}>
                      {card.rarity}
                    </span>
                  </div>
                  {card.tags && card.tags.length > 0 && (
                    <div className={classes('flex items-center overflow-hidden', GAP[1])}>
                      <Tag className={classes(ICON.sm, COLOR.muted, 'shrink-0')} />
                      <span className={classes(TYPE.caption, COLOR.muted, 'truncate')}>
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
                  <Gift className={ICON.sm} />
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
