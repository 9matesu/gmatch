// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { User } from '@orbit/shared';
import { PeerRoster } from '../../utils/peerRoster';
import { createTransportRegistry } from '../../utils/transportState';
import { PEER_STATUS_LABEL, PeerChip, peerChipStatus } from './PeerChip';

const peer = (id: string, displayName: string, online = true): User => ({
  id,
  display_name: displayName,
  online,
} as User);

const rowFor = (name: string): HTMLElement =>
  screen.getByText(name).closest('li') as HTMLElement;

describe('peerChipStatus — the three honest states', () => {
  it('calls a peer "connected" on a validated direct path or a live relay', () => {
    expect(peerChipStatus(peer('a', 'Alpha'), 'direct')).toBe('connected');
    expect(peerChipStatus(peer('a', 'Alpha'), 'relay')).toBe('connected');
    expect(peerChipStatus(peer('a', 'Alpha'), 'connecting-direct')).toBe('connecting');
    // idle has no dial in flight, so it reads as cannot-connect, not connecting.
    expect(peerChipStatus(peer('a', 'Alpha'), 'idle')).toBe('cannot-connect');
  });

  it('calls a failed dial or an offline roster row "cannot connect"', () => {
    expect(peerChipStatus(peer('a', 'Alpha'), 'failed')).toBe('cannot-connect');
    expect(peerChipStatus(peer('a', 'Alpha', false), 'direct')).toBe('cannot-connect');
    expect(peerChipStatus(undefined, 'direct')).toBe('cannot-connect');
  });
});

describe('PeerChip', () => {
  it('shows the real online roster count — never a fabricated number', () => {
    const roster = new PeerRoster(null);
    const registry = createTransportRegistry();
    render(<PeerChip roster={roster} registry={registry} />);
    expect(screen.getByRole('button', { name: 'Peers, 0 connected' })).toBeInTheDocument();
    act(() => {
      roster.upsert(peer('a', 'Alpha'));
      roster.upsert(peer('b', 'Beta'));
      // upsert is a fresh sighting (always online), so the ghost is loaded via
      // hydrate and is not counted as a connected peer.
      roster.hydrate([peer('c', 'Ghost', false)]);
    });
    // Two online, one persisted ghost: the ghost is not counted as connected.
    expect(screen.getByRole('button', { name: 'Peers, 2 connected' })).toHaveTextContent('2');
  });

  it('updates live when a peer joins or leaves the roster', () => {
    const roster = new PeerRoster(null);
    render(<PeerChip roster={roster} registry={createTransportRegistry()} />);
    act(() => { roster.upsert(peer('a', 'Alpha')) });
    expect(screen.getByRole('button', { name: 'Peers, 1 connected' })).toBeInTheDocument();
    act(() => { roster.markOffline('a') });
    expect(screen.getByRole('button', { name: 'Peers, 0 connected' })).toBeInTheDocument();
  });

  it('lists every peer with its status from the shared transport registry', () => {
    const roster = new PeerRoster(null);
    const registry = createTransportRegistry();
    act(() => {
      roster.upsert(peer('a', 'Alpha'));
      roster.upsert(peer('b', 'Beta'));
      registry.markDirectValidated('a');
      registry.startDirectAttempt('b');
    });
    render(<PeerChip roster={roster} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Peers, 2 connected' }));

    const dialog = screen.getByRole('dialog', { name: 'Connected peers' });
    expect(dialog).toHaveTextContent('Alpha');
    expect(dialog).toHaveTextContent('Beta');
    expect(rowFor('Alpha')).toHaveTextContent(PEER_STATUS_LABEL.connected);
    expect(rowFor('Beta')).toHaveTextContent(PEER_STATUS_LABEL.connecting);
  });

  it('follows a transport phase change without waiting for a roster change', () => {
    const roster = new PeerRoster(null);
    const registry = createTransportRegistry();
    act(() => {
      roster.upsert(peer('b', 'Beta'));
      registry.startDirectAttempt('b');
    });
    render(<PeerChip roster={roster} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Peers, 1 connected' }));
    expect(rowFor('Beta')).toHaveTextContent(PEER_STATUS_LABEL.connecting);

    act(() => { registry.markDirectValidated('b') });
    expect(rowFor('Beta')).toHaveTextContent(PEER_STATUS_LABEL.connected);
  });

  it('offers retry only for peers that cannot connect, with the peer id', () => {
    const roster = new PeerRoster(null);
    const registry = createTransportRegistry();
    const onRetry = vi.fn();
    act(() => {
      roster.upsert(peer('a', 'Alpha'));
      roster.upsert(peer('b', 'Beta'));
      roster.upsert(peer('d', 'Delta'));
      roster.hydrate([peer('c', 'Ghost', false)]);
      registry.markDirectValidated('a');
      // hasRelay=false is the only path that parks a peer in `failed` (with a
      // relay the transport honestly reports `relay` = still reachable).
      registry.markDirectFailed('b', 'no relay path', false);
      // Delta is left in `idle` (no dial in flight) — it must read cannot-connect
      // and be offered Retry just like a failed dial.
    });
    render(<PeerChip roster={roster} registry={registry} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Peers, 3 connected' }));

    const retryBeta = screen.getByRole('button', { name: 'Retry connecting to Beta' });
    expect(screen.getByRole('button', { name: 'Retry connecting to Delta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry connecting to Ghost' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry connecting to Alpha' })).toBeNull();
    fireEvent.click(retryBeta);
    expect(onRetry).toHaveBeenCalledWith('b');
  });

  it('is keyboard reachable: aria state, a native trigger, and closes on Escape', () => {
    const roster = new PeerRoster(null);
    render(<PeerChip roster={roster} registry={createTransportRegistry()} />);
    const trigger = screen.getByRole('button', { name: 'Peers, 0 connected' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Connected peers' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Connected peers' })).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside pointerdown but not on a click inside', () => {
    const roster = new PeerRoster(null);
    act(() => { roster.upsert(peer('a', 'Alpha')) });
    render(<PeerChip roster={roster} registry={createTransportRegistry()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Peers, 1 connected' }));
    const dialog = screen.getByRole('dialog', { name: 'Connected peers' });
    fireEvent.pointerDown(dialog);
    expect(screen.getByRole('dialog', { name: 'Connected peers' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Connected peers' })).toBeNull();
  });

  it('never invents peers when no roster is supplied', () => {
    render(<PeerChip />);
    expect(screen.getByRole('button', { name: 'Peers, 0 connected' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Peers, 0 connected' }));
    expect(screen.getByRole('dialog', { name: 'Connected peers' })).toHaveTextContent('No peers connected yet');
  });
});
