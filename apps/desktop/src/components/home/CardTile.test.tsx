// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardTile } from './CardTile';

vi.mock('../ObjectImage', () => ({
  ObjectImage: () => null,
}));

const base = {
  id: 'obj-1',
  owner_id: 'owner-1',
  content_url: 'https://x/obj-1.jpg',
  mime_type: 'image/jpeg',
  name: 'Test Card',
} as const;

describe('CardTile valuation footer', () => {
  it('shows the value for canonical cards', () => {
    render(<CardTile item={{ ...base, card_id: 'card-1', value: 2500, rarity: 'gold' } as never} />);
    expect(screen.getByText(/g\$ 2,500/)).toBeInTheDocument();
  });

  it('hides the value for unmapped objects instead of printing g$ 0', () => {
    const { container } = render(<CardTile item={{ ...base } as never} />);
    expect(container.textContent).not.toMatch(/g\$ 0/);
    // title + owner rows still render
    expect(screen.getByText('Test Card')).toBeInTheDocument();
  });
});
