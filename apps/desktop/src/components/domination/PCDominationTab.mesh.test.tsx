// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PCDominationTab } from './PCDominationTab';

vi.mock('../../utils/sounds', () => ({ playPress: vi.fn(), playWin: vi.fn(), playMsgReceive: vi.fn() }));
vi.mock('../../utils/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  orbitFetch: vi.fn(),
  postShareUrl: (id: string) => `https://api.test/p/${id}`,
}));
import { orbitFetch } from '../../utils/api';

vi.stubGlobal('IntersectionObserver', class {
  observe() { } unobserve() { } disconnect() { }
});

const storage: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = String(value) },
  removeItem: (key) => { delete storage[key] },
  clear: () => { for (const key of Object.keys(storage)) delete storage[key] },
  key: () => null,
  length: 0,
} as Storage;

const identity = { orbitId: 'me-1', publicKeyHex: 'a', privateKeyHex: 'b' } as never;

const TARGET = {
  id: 'peer-1',
  displayName: 'Bob',
  enabled: true,
  online: true,
  consents: {
    allowDesktopBackgroundChange: false,
    allowGameBackgroundChange: false,
    allowPopupVideo: false,
    allowPopupMessage: true,
    allowTextOverlay: false,
    allowBlurEverything: false,
    allowRemoteCamera: false,
  },
};

const ALL_CONSENTS = {
  allowDesktopBackgroundChange: true,
  allowDesktopWallpaperOS: true,
  allowGameBackgroundChange: true,
  allowPopupVideo: true,
  allowPopupMessage: true,
  allowTextOverlay: true,
  allowBlurEverything: true,
  allowRemoteCamera: true,
  allowPublicCamera: true,
  allowHacks: true,
};

function mockServerTargets(targets: unknown[]) {
  (orbitFetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
    if (String(url).includes('/api/domination/targets')) {
      return { ok: true, json: async () => ({ targets }) };
    }
    if (String(url).includes('/api/domination/settings')) {
      return { ok: true, json: async () => ({ enabled: false }) };
    }
    if (String(url).includes('/api/domination/history') || String(url).includes('/api/domination/outgoing')) {
      return { ok: true, json: async () => ({ actions: [] }) };
    }
    if (String(url).includes('/api/domination/trigger')) {
      return { ok: true, json: async () => ({ success: true, actionId: 'dom-1' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

function mockServer(target = TARGET) {
  mockServerTargets([target]);
}

const baseProps = {
  identity,
  users: [],
  allUsers: [],
  profilePics: {},
  points: 1000,
  toast: vi.fn(),
  activeHack: null,
  setActiveHack: vi.fn(),
  onOpenFlash: vi.fn(),
} as unknown as React.ComponentProps<typeof PCDominationTab>;

async function sendMessageFlow() {
  await userEvent.click(screen.getByRole('button', { name: /bob/i }));
  // Effect card name carries label + description; match the label prefix.
  const cards = screen.getAllByRole('button', { name: /message/i });
  await userEvent.click(cards.find((c) => (c.textContent || '').startsWith('Message')) || cards[0]);
  const box = screen.getByPlaceholderText(/what they will see/i);
  await userEvent.type(box, 'boo');
  await userEvent.click(screen.getByRole('button', { name: /send/i }));
}

describe('PCDominationTab mesh-first send (Fase 5/6 slice 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockServer();
  });

  it('mesh-known + consented target: seals via mesh, never POSTs trigger', async () => {
    const meshSend = vi.fn(async () => ({ ok: true as const, id: 'dom-99' }));
    const toast = vi.fn();
    render(
      <PCDominationTab
        {...baseProps}
        toast={toast}
        mesh={{ peerKnown: () => true, send: meshSend }}
      />,
    );
    await screen.findByRole('button', { name: /bob/i });
    await sendMessageFlow();
    await waitFor(() => expect(meshSend).toHaveBeenCalled());
    // (targetId, action, payload) — the 4th senderName arg is ambient.
    const firstCall = meshSend.mock.calls[0] as unknown[];
    expect(firstCall.slice(0, 2)).toEqual(['peer-1', 'message']);
    expect(firstCall[2]).toEqual(expect.objectContaining({ text: 'boo' }));
    const triggerCalls = (orbitFetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => String(c[0]).includes('/api/domination/trigger'),
    );
    expect(triggerCalls).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/Message sent to Bob\. Receipt shows in Outbox\./),
      'success',
    );
  });

  it('mesh-unknown target: falls back to the server trigger route', async () => {
    const meshSend = vi.fn();
    render(<PCDominationTab {...baseProps} mesh={{ peerKnown: () => false, send: meshSend }} />);
    await screen.findByRole('button', { name: /bob/i });
    await sendMessageFlow();
    await waitFor(() => {
      const triggerCalls = (orbitFetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => String(c[0]).includes('/api/domination/trigger'),
      );
      expect(triggerCalls.length).toBeGreaterThan(0);
    });
    expect(meshSend).not.toHaveBeenCalled();
  });

  it('renders no currency price anywhere, on either lane', async () => {
    for (const peerKnown of [true, false]) {
      render(<PCDominationTab {...baseProps} mesh={{ peerKnown: () => peerKnown, send: vi.fn() }} />);
      await screen.findByRole('button', { name: /bob/i });
      expect(screen.queryByText(/g\$|free via mesh|price/i)).toBeNull();
    }
  });

  it('every consented card is directly actionable; missing consent is the only block', async () => {
    mockServer({ ...TARGET, consents: ALL_CONSENTS });
    render(<PCDominationTab {...baseProps} mesh={{ peerKnown: () => false, send: vi.fn() }} />);
    await screen.findByRole('button', { name: /bob/i });
    const effectButtons = screen.getAllByRole('button').filter((b) =>
      ['Wallpaper', 'Game background', 'Video popup', 'Message', 'Banner text', 'Blur', 'Photo request']
        .some((label) => (b.textContent || '').startsWith(label)),
    );
    expect(effectButtons).toHaveLength(7);
    expect(effectButtons.some((b) => (b as HTMLButtonElement).disabled)).toBe(false);
  });

  it('lays the effect cards out as one dense, aligned grid (density contract)', async () => {
    mockServer({ ...TARGET, consents: ALL_CONSENTS });
    render(<PCDominationTab {...baseProps} mesh={{ peerKnown: () => false, send: vi.fn() }} />);
    await screen.findByRole('button', { name: /bob/i });
    const message = screen.getAllByRole('button').find((b) => (b.textContent || '').startsWith('Message'))!;
    const grid = message.parentElement as HTMLElement;
    expect(grid.className).toMatch(/\bgrid\b/);
    expect(grid.className).toMatch(/grid-cols-/);
    // No horizontal overflow from a fixed min-width wider than the track.
    expect(grid.className).not.toMatch(/min-w-\[/);
  });

  it('states the free model and never fabricates a landed ack on send', async () => {
    const meshSend = vi.fn(async () => ({ ok: true as const, id: 'dom-77' }));
    const toast = vi.fn();
    render(
      <PCDominationTab
        {...baseProps}
        toast={toast}
        mesh={{ peerKnown: () => true, send: meshSend }}
      />,
    );
    await screen.findByRole('button', { name: /bob/i });
    // The free + consent-gated model is stated up front, not buried.
    expect(screen.getByText(/free to send/i)).toBeTruthy();
    await sendMessageFlow();
    await waitFor(() => expect(meshSend).toHaveBeenCalled());
    // A sealed send is "sent / receipt in Outbox" — never a fabricated "landed".
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/Receipt shows in Outbox\./),
      'success',
    );
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/landed/i), expect.anything());
  });
});

/** The picker must only offer players a send would actually reach/accept. */
describe('PCDominationTab target freshness', () => {
  const STALE = {
    ...TARGET,
    id: 'peer-stale',
    displayName: 'Stale Sam',
    online: false,
    last_seen: '2026-09-01T00:00:00Z',
  };
  const DISABLED = { ...TARGET, id: 'peer-off', displayName: 'Off Olivia', enabled: false };
  const FRESH = { ...TARGET, id: 'peer-new', displayName: 'Fresh Fran' };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('drops stale/offline and Domination-disabled players; keeps the fresh online one', async () => {
    mockServerTargets([STALE, DISABLED, FRESH]);
    render(<PCDominationTab {...baseProps} mesh={{ peerKnown: () => false, send: vi.fn() }} />);
    await screen.findByRole('button', { name: /fresh fran/i });
    expect(screen.queryByRole('button', { name: /stale sam/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /off olivia/i })).toBeNull();
    expect(screen.getByText(/1 online/)).toBeTruthy();
  });

  it('states an honest empty state when nobody is currently reachable', async () => {
    mockServerTargets([STALE]);
    render(<PCDominationTab {...baseProps} mesh={{ peerKnown: () => false, send: vi.fn() }} />);
    await waitFor(() =>
      expect(screen.getByText(/Nobody is online with Domination enabled/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /stale sam/i })).toBeNull();
  });

  it('keeps a fresh target sendable with a real ack — still free, still consent-gated', async () => {
    mockServerTargets([STALE, TARGET]);
    const toast = vi.fn();
    render(
      <PCDominationTab
        {...baseProps}
        toast={toast}
        mesh={{ peerKnown: () => false, send: vi.fn() }}
      />,
    );
    await screen.findByRole('button', { name: /bob/i });
    expect(screen.queryByRole('button', { name: /stale sam/i })).toBeNull();
    expect(screen.queryByText(/g\$|price/i)).toBeNull();
    await sendMessageFlow();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.stringMatching(/Landed status shows in Outbox\./),
        'success',
      ));
  });
});
