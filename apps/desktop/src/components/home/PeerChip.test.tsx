// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('labels ONLY the real transport: direct, relay, failed — never a guess', () => {
    const roster = new PeerRoster(null);
    const registry = createTransportRegistry();
    act(() => {
      roster.upsert(peer('a', 'Alpha'));
      roster.upsert(peer('b', 'Beta'));
      roster.upsert(peer('c', 'Cy'));
      roster.upsert(peer('d', 'Delta'));
      registry.markDirectValidated('a');
      registry.markRelayInUse('b');
      registry.markDirectFailed('c', 'no relay', false);
      // Delta stays `idle`: no dial has opened, so no route may be claimed.
    });
    render(<PeerChip roster={roster} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Peers, 4 connected' }));

    expect(rowFor('Alpha')).toHaveTextContent('P2P direto');
    expect(rowFor('Beta')).toHaveTextContent('relay via nó (NAT)');
    expect(rowFor('Cy')).toHaveTextContent('sem rota');
    expect(rowFor('Delta').textContent).not.toMatch(/P2P direto|relay via nó|sem rota/);
  });

  it('the count is the roster projection, not a supplied snapshot', () => {
    const roster = new PeerRoster(null);
    act(() => { roster.upsert(peer('a', 'Alpha')) });
    render(
      <PeerChip
        roster={roster}
        peers={[peer('stale-1', 'Stale 1'), peer('stale-2', 'Stale 2')]}
        registry={createTransportRegistry()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Peers, 1 connected' })).toHaveTextContent('1');
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

describe('PeerChip popover placement', () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;

  const viewport = (width: number, height: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
  };

  /** Open the chip with a measured trigger rect so the fixed popover's anchors
   *  are computable in jsdom (which reports a 0x0 rect by default). */
  const openAt = (top: number, right: number) => {
    const roster = new PeerRoster(null);
    act(() => { roster.upsert(peer('a', 'Alpha')) });
    const { container } = render(<PeerChip roster={roster} registry={createTransportRegistry()} />);
    const trigger = container.querySelector('[data-peer-chip]') as HTMLElement;
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      top, bottom: top + 28, right, left: right - 32,
      width: 32, height: 28, x: right - 32, y: top, toJSON: () => ({}),
    } as DOMRect);
    fireEvent.click(trigger);
    return screen.getByRole('dialog', { name: 'Connected peers' });
  };

  afterEach(() => {
    vi.restoreAllMocks();
    viewport(originalWidth, originalHeight);
  });

  it('anchors ABOVE the chip, never below it', () => {
    viewport(800, 600);
    const dialog = openAt(300, 700);
    // bottom: B puts a fixed box's bottom edge at y = innerHeight - B. To sit
    // above a trigger at y=300, B must be >= 600 - 300.
    const bottom = Number.parseFloat(dialog.style.bottom);
    expect(Number.isNaN(bottom)).toBe(false); // the trigger ref must be wired
    expect(bottom).toBe(window.innerHeight - 300 + 8);
    expect(bottom).toBeGreaterThanOrEqual(window.innerHeight - 300);
    expect(dialog.style.right).toBe(`${window.innerWidth - 700}px`);
  });

  it('clamps both edges inside a small viewport', () => {
    viewport(320, 400);
    const dialog = openAt(380, 40);
    const bottom = Number.parseFloat(dialog.style.bottom);
    const right = Number.parseFloat(dialog.style.right);
    expect(bottom).toBeGreaterThanOrEqual(window.innerHeight - 380);
    expect(bottom).toBeLessThanOrEqual(window.innerHeight - 8);
    expect(right).toBeGreaterThanOrEqual(8);
    // w-72 = 288px: the left edge must not go past the viewport either.
    expect(right).toBeLessThanOrEqual(window.innerWidth - 288 - 8);
  });

  it('opens and closes on a small viewport, with a bounded scroll body', () => {
    viewport(320, 360);
    const dialog = openAt(300, 40);
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toContain('max-h-');
    expect(dialog.querySelector('.overflow-y-auto')).not.toBeNull();
    expect(dialog).toHaveTextContent('Alpha');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Connected peers' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Peers, 1 connected' }));
    expect(screen.getByRole('dialog', { name: 'Connected peers' })).toBeInTheDocument();
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('dialog', { name: 'Connected peers' })).toBeNull();
  });
});
