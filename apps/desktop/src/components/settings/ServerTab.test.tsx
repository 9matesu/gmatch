// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServerTab } from './ServerTab';

// vi.mock hoists above imports on purpose: identity off, no audio.
vi.mock('../../hooks/useIdentity', () => ({ useIdentity: () => ({ identity: null }) }));
vi.mock('../../utils/sounds', () => ({ playPress: vi.fn() }));

const serverRelaunch = vi.fn();
const serverSet = vi.fn(async () => ({ ok: true }));

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  Object.defineProperty(window, 'gmatch', {
    configurable: true,
    value: {
      serverState: async () => ({ packaged: true, mode: 'client', url: 'https://gmatch.pages.dev', lanUrls: [] }),
      serverSet,
      serverRelaunch,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { gmatch?: unknown }).gmatch;
});

describe('ServerTab', () => {
  it('saving does NOT force-restart; the user confirms with Restart now', async () => {
    render(<ServerTab />);
    serverSet.mockClear();
    serverRelaunch.mockClear();
    await userEvent.clear(await screen.findByLabelText('Friend server address'));
    await userEvent.type(screen.getByLabelText('Friend server address'), 'http://192.168.0.42:8790');
    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(serverSet).toHaveBeenCalled());
    expect(serverRelaunch).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Restart now' }));
    expect(serverRelaunch).toHaveBeenCalled();
  });

  it('does not warn about a paused saved node: hosting locally is the normal state', async () => {
    Object.defineProperty(window, 'gmatch', {
      configurable: true,
      value: {
        serverState: async () => ({
          packaged: true,
          mode: 'host',
          url: 'http://127.0.0.1:8790',
          lanUrls: [],
          pausedUrl: 'https://old.example.test',
          pausedReason: 'legacy',
        }),
        serverSet,
        serverRelaunch,
      },
    });
    render(<ServerTab />);

    await screen.findByText(/this computer hosts the server/i);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/older version/i)).toBeNull();
    expect(screen.queryByText(/did not answer/i)).toBeNull();
  });
});
