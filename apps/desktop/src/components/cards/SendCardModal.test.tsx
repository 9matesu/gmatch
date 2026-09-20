// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SendCardModal } from './SendCardModal';

const dummyIdentity: any = { orbitId: 'alice-orbit-id' };

const dummyCards: any[] = [
  {
    id: 'card-1',
    name: 'Cyber Blade',
    rarity: 'rare',
    value: 500,
    tags: ['cyber', 'blade'],
    ownerId: 'alice-orbit-id',
  },
  {
    id: 'card-2',
    name: 'Neon Shield',
    rarity: 'uncommon',
    value: 250,
    tags: ['neon'],
    ownerId: 'alice-orbit-id',
  },
];

describe('SendCardModal', () => {
  it('renders owned cards for gifting and transfers selected card on click', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    render(
      <SendCardModal
        isOpen={true}
        onClose={onClose}
        recipientId="bob-orbit-id"
        recipientName="Bob"
        identity={dummyIdentity}
        cards={dummyCards}
        onSendCard={onSend}
      />
    );

    expect(screen.getByRole('heading', { name: /Gift a Card to Bob/i })).toBeDefined();
    expect(screen.getByText('Cyber Blade')).toBeDefined();
    expect(screen.getByText('Neon Shield')).toBeDefined();

    const sendBtn = screen.getAllByRole('button', { name: /Send as Gift/i })[0];
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('card-1', 'bob-orbit-id');
    });
  });

  it('shows empty message when no owned cards exist', () => {
    render(
      <SendCardModal
        isOpen={true}
        onClose={vi.fn()}
        recipientId="bob-orbit-id"
        recipientName="Bob"
        identity={dummyIdentity}
        cards={[]}
      />
    );

    expect(screen.getByText(/No cards in your collection to gift/i)).toBeDefined();
  });
});
