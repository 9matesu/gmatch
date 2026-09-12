// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useServerHeartbeat } from './useServerHeartbeat';

const orbitFetch = vi.fn();
vi.mock('../utils/api', () => ({ orbitFetch: (...a: unknown[]) => orbitFetch(...a) }));
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

beforeEach(() => {
  store.clear();
  stubStorage();
  orbitFetch.mockReset();
  orbitFetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/servers/node')) {
      return { ok: true, json: async () => ({ name: 'My Box', description: 'd', isAdmin: true }) };
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
      const post = orbitFetch.mock.calls.find(
        ([u, o]) => String(u).startsWith('https://central.test/api/servers') && (o as { method?: string })?.method === 'POST',
      );
      expect(post).toBeTruthy();
    });
    const post = orbitFetch.mock.calls.find(
      ([u, o]) => String(u).startsWith('https://central.test/api/servers') && (o as { method?: string })?.method === 'POST',
    )!;
    const body = JSON.parse((post[1] as { body: string }).body);
    expect(body.name).toBe('My Box');
    expect(body.endpoint_hint).toBe('192.168.0.9:8790');
    expect(store.get('gmatch.server.register')).toBeTruthy();
  });

  it('reports owner_name from the local display name on every replay', async () => {
    store.set('gmatch.server.register', JSON.stringify({ name: 'Old', description: '', endpoint_hint: 'h:1', password_required: false }));
    store.set('orbit_display_name', 'Alice');
    stubHostState([]);
    renderHook(() => useServerHeartbeat(identity));
    await vi.waitFor(() => {
      const post = orbitFetch.mock.calls.find(
        ([u, o]) => String(u).startsWith('https://central.test/api/servers') && (o as { method?: string })?.method === 'POST',
      );
      expect(post).toBeTruthy();
    });
    const post = orbitFetch.mock.calls.find(
      ([u, o]) => String(u).startsWith('https://central.test/api/servers') && (o as { method?: string })?.method === 'POST',
    )!;
    expect(JSON.parse((post[1] as { body: string }).body).owner_name).toBe('Alice');
  });
});
