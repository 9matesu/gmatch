// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { generateIdentity } from '@orbit/crypto';
import { Avatar } from './Avatar';
import { broadcastPresence, fetchPresenceRosterFrom } from '../services/courierPresence';
import { registerLocalObject, sha256HexBlob } from '../utils/p2pSwarm';

vi.mock('../services/imageCache', () => ({
  resolveImage: vi.fn(async (url: string) =>
    url.includes('cached') ? 'gmcache://disk-hash' : url
  ),
  devFetchable: vi.fn((url: string) =>
    url.includes('dev-proxy') ? '/px?u=' + encodeURIComponent(url) : null
  ),
  cachedImageFor: vi.fn(() => undefined),
}));

// A cross-node avatar resolves through the SAME useObjectImage ladder as a
// peer post. Drive it directly so the test pins the wiring, not the transport.
vi.mock('../hooks/useIdentity', () => ({
  useIdentity: vi.fn(() => ({
    identity: { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' },
  })),
}));
vi.mock('../hooks/useObjectImage', () => ({
  useObjectImage: vi.fn(() => ({
    url: null, failed: false, isVideo: false, isLink: false, linkUrl: null, awaitingSeeder: false,
  })),
}));

describe('Avatar offline cache and fallback', () => {
  beforeAll(() => {
    // jsdom's Blob has no arrayBuffer(); Chromium (the real runtime) does.
    if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as ArrayBuffer);
          fr.onerror = () => reject(fr.error);
          fr.readAsArrayBuffer(this);
        });
      };
    }
  });

  beforeEach(async () => {
    const { useObjectImage } = await import('../hooks/useObjectImage');
    vi.mocked(useObjectImage).mockReset().mockReturnValue({
      url: null, failed: false, isVideo: false,
      isLink: false, linkUrl: null, awaitingSeeder: false,
    });
  });

  it('resolves image through disk cache when available', async () => {
    const { container } = render(<Avatar id="user-1" imageUrl="https://cdn.example.com/cached-pfp.jpg" />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', 'gmcache://disk-hash');
    });
  });

  it('falls back to geometric SVG without broken image on error', async () => {
    const { container } = render(<Avatar id="user-2" imageUrl="https://cdn.example.com/broken-pfp.jpg" />);
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    fireEvent.error(img!);
    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  it('proxies external booru/CDN avatar URLs through /px in dev', async () => {
    const { container } = render(<Avatar id="user-3" imageUrl="https://cdn.example.com/dev-proxy-avatar.jpg" />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', '/px?u=https%3A%2F%2Fcdn.example.com%2Fdev-proxy-avatar.jpg');
    });
  });

  it('renders fill={true} as in-flow w-full h-full without unconstrained absolute inset-0', async () => {
    const { container } = render(
      <div className="w-8 h-8">
        <Avatar id="user-fill-1" imageUrl="https://cdn.example.com/cached-pfp.jpg" fill={true} />
      </div>
    );
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toBeTruthy();
      expect(img?.className).toContain('w-full h-full object-cover');
      expect(img?.className).not.toContain('absolute');
      expect(img?.className).not.toContain('inset-0');
    });
  });

  it('renders fallback SVG with fill={true} without absolute positioning', () => {
    const { container } = render(
      <div className="w-8 h-8">
        <Avatar id="user-fill-svg" imageUrl={null} fill={true} />
      </div>
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.className.baseVal || svg?.getAttribute('class')).toContain('w-full h-full');
    expect(svg?.className.baseVal || svg?.getAttribute('class')).not.toContain('absolute');
  });

  it('resolves a content-addressed avatar through the verified media ladder', async () => {
    const { useObjectImage } = await import('../hooks/useObjectImage');
    const hash = 'b'.repeat(64);
    vi.mocked(useObjectImage).mockReturnValue({
      url: 'blob:verified-avatar', failed: false, isVideo: false,
      isLink: false, linkUrl: null, awaitingSeeder: false,
    });
    const { container } = render(<Avatar id="peer-1" imageUrl={`urn:sha256:${hash}`} />);

    expect(useObjectImage).toHaveBeenCalledWith(hash, expect.objectContaining({ orbitId: 'me' }), { contentHash: hash });
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:verified-avatar');
    // The pfp endpoint on OUR node is never asked for a peer's bytes.
    expect(container.querySelector('img')?.getAttribute('src')).not.toContain('/api/users/');
  });

  it('renders a presence-roster pfpHash through the verified content ladder', async () => {
    // The whole cross-node hand-off: a peer advertises its local avatar by
    // hash, the reader's roster exposes urn:sha256:<hash>, and Avatar must
    // resolve THAT hash — never our node's /api/users/:id/pfp route.
    const avatar = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7, 7])], { type: 'image/png' });
    const hash = await sha256HexBlob(avatar);
    registerLocalObject('avatar-object-1', avatar);
    const peer = generateIdentity();
    const boxes = new Map<string, any[]>();
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/mail/')) {
        const base = u.split('/api/mail/')[0];
        if (init?.method === 'PUT') {
          boxes.set(base, [...(boxes.get(base) ?? []), JSON.parse(String(init.body)).env]);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ envelopes: boxes.get(base) ?? [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ lanUrls: [] }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const store = new Map<string, string>([['gmatch.api.url', 'http://node.test:8790']]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    } as Storage);
    await broadcastPresence(peer as any, { displayName: 'Peer', pfpUrl: '/api/objects/avatar-object-1' }, fetchMock);
    const roster = await fetchPresenceRosterFrom('http://node.test:8790', 'me', fetchMock);
    const row = roster.users.find((u) => u.id === (peer as any).orbitId)!;
    expect(row.pfp_url).toBe(`urn:sha256:${hash}`);

    const { useObjectImage } = await import('../hooks/useObjectImage');
    vi.mocked(useObjectImage).mockReturnValue({
      url: 'blob:peer-avatar', failed: false, isVideo: false,
      isLink: false, linkUrl: null, awaitingSeeder: false,
    });
    const { container } = render(<Avatar id={row.id} imageUrl={row.pfp_url} />);

    expect(useObjectImage).toHaveBeenCalledWith(hash, expect.anything(), { contentHash: hash });
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:peer-avatar');
    vi.unstubAllGlobals();
  });

  it('shows the honest fallback when no peer can serve a hashed avatar', async () => {
    const { useObjectImage } = await import('../hooks/useObjectImage');
    const hash = 'c'.repeat(64);
    vi.mocked(useObjectImage).mockReturnValue({
      url: null, failed: true, isVideo: false,
      isLink: false, linkUrl: null, awaitingSeeder: false,
    });
    const { container } = render(<Avatar id="peer-2" imageUrl={`/api/objects/${hash}`} />);

    expect(useObjectImage).toHaveBeenCalledWith(hash, expect.anything(), { contentHash: hash });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
