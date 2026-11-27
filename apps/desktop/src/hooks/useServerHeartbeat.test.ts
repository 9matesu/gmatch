// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useServerHeartbeat } from './useServerHeartbeat';

const orbitFetch = vi.fn();
const api = vi.hoisted(() => ({ base: '' }));
vi.mock('../utils/api', () => ({
  orbitFetch: (...a: unknown[]) => orbitFetch(...a),
  getApiBaseUrl: () => api.base,
  isLoopbackApiUrl: (u: string | null | undefined) => {
    if (!u) return false;
    return /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(u.trim());
  },
}));
vi.mock('../utils/central', () => ({ getCentralApiUrl: () => 'https://central.test' }));

const store = new Map<string, string>();
const identity = { orbitId: 'me' } as never;

function stubStorage() {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}

function stubHostState(lanUrls: string[]) {
  Object.defineProperty(window, 'gmatch', {
    configurable: true,
    value: { serverState: async () => ({ packaged: true, mode: 'host', url: 'http://127.0.0.1:8790', lanUrls }) },
  });
}

/** The POST that publishes this machine to the directory. */
function findPublish() {
  return orbitFetch.mock.calls.find(
    ([u, o]) => String(u).startsWith('https://central.test/api/servers') && (o as { method?: string })?.method === 'POST',
  );
}

beforeEach(() => {
  store.clear();
  stubStorage();
  api.base = '';
  orbitFetch.mockReset();
  orbitFetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/servers/node')) {
      return { ok: true, json: async () => ({ name: 'My Box', description: 'd', isAdmin: true, mode: 'host', lanUrls: ['http://192.168.5.2:8790'] }) };
    }
    if (String(url).includes('/api/servers/dashboard')) {
      return { ok: true, json: async () => ({ users: [], posts_24h: 0, members_total: 3 }) };
    }
    return { ok: true, json: async () => ({}) };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { gmatch?: unknown }).gmatch;
});

describe('useServerHeartbeat', () => {
  it('bootstrap: host without a claim marker registers itself with the node name + LAN hint', async () => {
    stubHostState(['http://192.168.0.9:8790']);
    renderHook(() => useServerHeartbeat(identity));
    await vi.waitFor(() => {
      expect(findPublish()).toBeTruthy();
    });
    const post = findPublish()!;
    const body = JSON.parse((post[1] as { body: string }).body);
    expect(body.name).toBe('My Box');
    expect(body.endpoint_hint).toBe('http://192.168.0.9:8790');
    expect(store.get('gmatch.server.register')).toBeTruthy();
  });

  it('reports owner_name from the local display name on every replay', async () => {
    store.set('gmatch.server.register', JSON.stringify({ name: 'Old', description: '', endpoint_hint: 'h:1', password_required: false }));
    store.set('orbit_display_name', 'Alice');
    stubHostState([]);
    renderHook(() => useServerHeartbeat(identity));
    await vi.waitFor(() => {
      expect(findPublish()).toBeTruthy();
    });
    const post = findPublish()!;
    expect(JSON.parse((post[1] as { body: string }).body).owner_name).toBe('Alice');
  });

  it('browser build: replays the registration the user made and fills in the node address', async () => {
    // No Electron bridge: the node answers for itself.
    store.set('gmatch.server.register', JSON.stringify({ name: 'My Realm', description: 'd', endpoint_hint: '', password_required: false }));
    renderHook(() => useServerHeartbeat(identity));
    await vi.waitFor(() => {
      expect(findPublish()).toBeTruthy();
    });
    const body = JSON.parse((findPublish()![1] as { body: string }).body);
    expect(body.name).toBe('My Realm');
    expect(body.endpoint_hint).toBe('http://192.168.5.2:8790');
    // the filled address is kept, so the Servers screen shows the same one
    expect(JSON.parse(store.get('gmatch.server.register') || '{}').endpoint_hint).toBe('http://192.168.5.2:8790');
  });

  it('browser build: never invents a registration of its own', async () => {
    renderHook(() => useServerHeartbeat(identity));
    await vi.waitFor(() => {
      expect(orbitFetch.mock.calls.some(([u]) => String(u).includes('/api/servers/node'))).toBe(true);
    });
    expect(findPublish()).toBeFalsy();
    expect(store.get('gmatch.server.register')).toBeFalsy();
  });

  it('browser build pointed at another machine node does not publish this machine', async () => {
    api.base = 'http://192.168.1.50:8790';
    store.set('gmatch.server.register', JSON.stringify({ name: 'My Realm', description: '', endpoint_hint: '', password_required: false }));
    renderHook(() => useServerHeartbeat(identity));
    await vi.waitFor(() => {
      expect(orbitFetch.mock.calls.some(([u]) => String(u).includes('/api/servers/node'))).toBe(true);
    });
    expect(findPublish()).toBeFalsy();
  });
});
