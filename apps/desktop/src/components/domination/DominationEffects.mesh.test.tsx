// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DominationEffects } from './DominationEffects';

vi.mock('../../utils/sounds', () => ({ playPress: vi.fn(), playWin: vi.fn(), playMsgReceive: vi.fn() }));
vi.mock('../../utils/api', () => ({ orbitFetch: vi.fn(async () => ({ ok: false })) }));
vi.mock('../game/useGame', () => ({ useGame: { getState: () => ({ notify: vi.fn() }) } }));

const storage: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = String(value) },
  removeItem: (key) => { delete storage[key] },
  clear: () => { for (const key of Object.keys(storage)) delete storage[key] },
  key: () => null,
  length: 0,
} as Storage;

const identity = { orbitId: 'me-1' } as never;

function presetSettings(patch: Record<string, unknown>) {
  localStorage.setItem('goonmatch-settings', JSON.stringify({
    pcDominationEnabled: true,
    allowPopupMessage: true,
    allowRemoteCamera: true,
    cameraPermissionMode: 'prompt',
    dominationInboundMutedUntil: 0,
    ...patch,
  }));
}

function meshEffect(detail: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new CustomEvent('gmatch:domination-mesh-effect', { detail }));
  });
}

describe('DominationEffects mesh inbound (Fase 5/6 slice 5)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders a consented mesh message effect', async () => {
    presetSettings({});
    render(<DominationEffects identity={identity} />);
    meshEffect({ action: 'message', from: 'peer-9', senderName: 'Bob', payload: { text: 'mesh hi' } });
    expect(await screen.findByText('mesh hi')).toBeInTheDocument();
  });

  it('drops mesh effects under panic pause', async () => {
    presetSettings({ dominationInboundMutedUntil: Date.now() + 600_000 });
    render(<DominationEffects identity={identity} />);
    meshEffect({ action: 'message', from: 'peer-9', payload: { text: 'should not render' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('should not render')).toBeNull();
  });

  it('rechecks consent on the receiver (defense in depth)', async () => {
    presetSettings({ allowPopupMessage: false });
    render(<DominationEffects identity={identity} />);
    meshEffect({ action: 'message', from: 'peer-9', payload: { text: 'no consent' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('no consent')).toBeNull();
  });

  it('ignores unknown mesh actions', async () => {
    presetSettings({});
    const { container } = render(<DominationEffects identity={identity} />);
    meshEffect({ action: 'nuke', from: 'peer-9', payload: {} });
    await new Promise((r) => setTimeout(r, 50));
    // No effects render (only the <style> tag): zero divs.
    expect(container.querySelectorAll('div').length).toBe(0);
  });

  it('mesh camera ask emits a decision event with the mesh request id', async () => {
    presetSettings({});
    const seen: Array<{ id?: string; approved?: boolean }> = [];
    const onDecision = (e: Event) => {
      seen.push((e as CustomEvent).detail);
    };
    window.addEventListener('gmatch:domination-camera-decision', onDecision);
    try {
      render(<DominationEffects identity={identity} />);
      meshEffect({ action: 'camera', from: 'peer-9', payload: {}, meshId: 'dom-cam-1' });
      expect(await screen.findByText(/asking for a photo/i)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /decline/i }));
      expect(seen).toEqual([{ id: 'dom-cam-1', approved: false }]);
    } finally {
      window.removeEventListener('gmatch:domination-camera-decision', onDecision);
    }
  });
});
