// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingFlow } from './OnboardingFlow';
import { SERVER_MARKER_KEY } from './onboardingState';

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  } as Storage);
}

describe('OnboardingFlow', () => {
  beforeEach(() => {
    stubLocalStorage({ 'gmatch.central.url': 'https://central.test' });
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/servers')) {
        return new Response(JSON.stringify({ servers: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
  });

  it('mounts directly at profile step without initial server browser and creates account', async () => {
    const onCreateAccount = vi.fn().mockResolvedValue(undefined);
    const onLogin = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();

    render(
      <OnboardingFlow
        identity={null}
        initialProfile={{ displayName: '', tags: [] }}
        onCreateAccount={onCreateAccount}
        onLogin={onLogin}
        onProfileUpdated={() => {}}
        onComplete={onComplete}
        ensureIdentity={() => null}
      />
    );

    // Mounts straight to profile setup without server browser
    expect(screen.getByText('Set up your profile')).toBeInTheDocument();
    expect(screen.queryByText('gMatch Central (p2p)')).not.toBeInTheDocument();

    const nameInput = screen.getByRole('textbox', { name: /display name/i });
    fireEvent.change(nameInput, { target: { value: 'DirectP2PUser' } });

    const enterBtn = screen.getByRole('button', { name: /enter/i });
    fireEvent.click(enterBtn);

    await waitFor(() => {
      expect(onCreateAccount).toHaveBeenCalledWith('DirectP2PUser', '', undefined);
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('mounts directly at profile step when server marker is already set and creates account', async () => {
    stubLocalStorage({
      'gmatch.central.url': 'https://central.test',
      [SERVER_MARKER_KEY]: 'https://gmatch.fly.dev',
      'gmatch.api.url': 'https://gmatch.fly.dev',
    });

    const onCreateAccount = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();

    render(
      <OnboardingFlow
        identity={null}
        initialProfile={{ displayName: '', tags: [] }}
        onCreateAccount={onCreateAccount}
        onLogin={vi.fn()}
        onProfileUpdated={() => {}}
        onComplete={onComplete}
        ensureIdentity={() => null}
      />
    );

    expect(screen.getByText('Set up your profile')).toBeInTheDocument();

    const nameInput = screen.getByRole('textbox', { name: /display name/i });
    fireEvent.change(nameInput, { target: { value: 'VoyeurMaster' } });

    const enterBtn = screen.getByRole('button', { name: /enter/i });
    fireEvent.click(enterBtn);

    await waitFor(() => {
      expect(onCreateAccount).toHaveBeenCalledWith('VoyeurMaster', '', undefined);
    });
    expect(onComplete).toHaveBeenCalled();
  });
});
