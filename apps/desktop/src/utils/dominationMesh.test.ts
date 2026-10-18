// Protocol hardening tests: payload schemas, clamps, expiry, receiver-side
// rate spacing, bounded idempotency, execution receipts, sealed photo frames.
// These pin the receiver's fail-closed posture — anything malformed or stale
// is refused, never executed.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  DOM_LIMITS,
  decodeDomBody,
  encodeDomRequest,
  validateDomPayload,
} from './dominationMesh';
import { DominationMeshManager, type DominationMeshDeps } from './dominationMeshManager';

const peerKeys = { publicKeyHex: 'aa', encryptionPubHex: 'bb' };

function makeDeps(overrides: Partial<DominationMeshDeps> = {}) {
  const sent: Array<{ body: string; to: unknown }> = [];
  const deps: DominationMeshDeps = {
    mail: {
      send: async (body: string, to: unknown) => {
        sent.push({ body, to });
        return { id: `m-${sent.length}` };
      },
    },
    getPeerKeys: () => peerKeys,
    addressPeer: () => 'addr',
    isConsented: () => true,
    onOutboxStatus: vi.fn(),
    onIncomingEffect: vi.fn(),
    ...overrides,
  };
  return { deps, sent };
}

function opened(body: string, senderOrbitId = 'peer-1') {
  return { body, senderPubHex: 'sp', senderOrbitId } as never;
}
const env = { fromEph: 'eph' } as never;

describe('validateDomPayload', () => {
  it('clamps duration and intensity into the hard bounds', () => {
    const blur = validateDomPayload('blur', { intensity: 999, duration: 999_999_999 });
    expect(blur).toEqual({
      ok: true,
      payload: { intensity: DOM_LIMITS.intensity.max, duration: DOM_LIMITS.duration.max },
    });
    const low = validateDomPayload('blur', { intensity: -5, duration: 1 });
    expect(low.ok && low.payload).toMatchObject({ intensity: DOM_LIMITS.intensity.min, duration: DOM_LIMITS.duration.min });
  });

  it('strips unknown payload keys so nothing rides along unvalidated', () => {
    const r = validateDomPayload('message', { text: 'hi', evil: '<script>', exec: 'rm -rf' });
    expect(r.ok && r.payload).toEqual({ text: 'hi', duration: DOM_LIMITS.duration.messageDefault });
  });

  it('rejects non-https and oversized urls, empty text', () => {
    expect(validateDomPayload('wallpaper', { url: 'http://x/y.jpg' }).ok).toBe(false);
    expect(validateDomPayload('wallpaper', { url: 'file:///C:/x.jpg' }).ok).toBe(false);
    expect(validateDomPayload('wallpaper', { url: `https://x/${'a'.repeat(3000)}.jpg` }).ok).toBe(false);
    expect(validateDomPayload('wallpaper', {}).ok).toBe(false);
    expect(validateDomPayload('message', { text: '   ' }).ok).toBe(false);
    const long = validateDomPayload('message', { text: 'x'.repeat(500) });
    expect(long.ok && (long.payload as Record<string, unknown>).text).toHaveLength(DOM_LIMITS.textMax.message);
  });

  it('falls back to safe banner styling and clamps camera quality', () => {
    const banner = validateDomPayload('text_overlay', { text: 'hi', position: 'DROP TABLE', size: 'huge', color: 'evil();' });
    expect(banner.ok && banner.payload).toMatchObject({ position: 'center', size: 'large', color: '#9FE3FF' });
    const cam = validateDomPayload('camera', { quality: 42, isPublic: 'yes' });
    expect(cam.ok && cam.payload).toEqual({ quality: DOM_LIMITS.quality.max, isPublic: false });
  });

  it('fails for unknown actions', () => {
    expect(validateDomPayload('nuke', {}).ok).toBe(false);
  });
});

describe('decodeDomBody hardening', () => {
  it('accepts the extended receipt statuses and rejects garbage ones', () => {
    for (const status of ['landed', 'declined', 'completed', 'failed', 'expired'] as const) {
      expect(decodeDomBody(JSON.stringify({ t: 'dom_receipt', id: 'x', status }))).toMatchObject({ status });
    }
    expect(decodeDomBody(JSON.stringify({ t: 'dom_receipt', id: 'x', status: 'executed' }))).toBeNull();
  });

  it('keeps a numeric exp and drops a malformed one', () => {
    const good = decodeDomBody(encodeDomRequest({ id: 'a', action: 'blur', exp: 123 }));
    expect(good).toMatchObject({ exp: 123 });
    const bad = decodeDomBody(JSON.stringify({ t: 'dom_request', id: 'a', action: 'blur', exp: 'soon' }));
    expect(bad).not.toHaveProperty('exp');
  });

  it('accepts a well-formed sealed photo and rejects an oversized one', () => {
    const ok = decodeDomBody(JSON.stringify({ t: 'dom_photo', id: 'p', data: 'data:image/jpeg;base64,ZnJhbWU=' }));
    expect(ok).toMatchObject({ t: 'dom_photo', id: 'p' });
    const huge = 'data:image/jpeg;base64,' + 'A'.repeat(DOM_LIMITS.photoMaxBytes * 2);
    expect(decodeDomBody(JSON.stringify({ t: 'dom_photo', id: 'p', data: huge }))).toBeNull();
    expect(decodeDomBody(JSON.stringify({ t: 'dom_photo', id: 'p', data: 'data:text/html;base64,PGI+' }))).toBeNull();
  });
});

describe('DominationMeshManager hardening', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sender validates the payload before sealing (invalid fails loud, nothing sent)', async () => {
    const { deps, sent } = makeDeps();
    const mgr = new DominationMeshManager(deps);
    const r = await mgr.sendEffect('peer-1', 'message', { text: '' });
    expect(r).toEqual({ ok: false, reason: 'invalid-payload' });
    expect(sent).toHaveLength(0);
  });

  it('expired requests are refused with an expired receipt, never executed', async () => {
    const { deps, sent } = makeDeps();
    const onIncomingEffect = vi.fn();
    deps.onIncomingEffect = onIncomingEffect;
    const mgr = new DominationMeshManager(deps);
    mgr.handleOpened(opened(JSON.stringify({ t: 'dom_request', id: 'old', action: 'blur', exp: Date.now() - 1000 })), env);
    expect(onIncomingEffect).not.toHaveBeenCalled();
    expect(JSON.parse(sent[0].body)).toEqual({ t: 'dom_receipt', id: 'old', status: 'expired' });
  });

  it('spaces identical sender+action sends inside the cooldown window', async () => {
    const { deps, sent } = makeDeps();
    const mgr = new DominationMeshManager(deps);
    mgr.handleOpened(opened(JSON.stringify({ t: 'dom_request', id: 'r1', action: 'blur' })), env);
    mgr.handleOpened(opened(JSON.stringify({ t: 'dom_request', id: 'r2', action: 'blur' })), env);
    const statuses = sent.map((s) => JSON.parse(s.body).status);
    expect(statuses).toEqual(['landed', 'declined']);
  });

  it('clamps payloads at the receiver before rendering (defense in depth)', async () => {
    const { deps } = makeDeps();
    const onIncomingEffect = vi.fn();
    deps.onIncomingEffect = onIncomingEffect;
    const mgr = new DominationMeshManager(deps);
    mgr.handleOpened(opened(JSON.stringify({ t: 'dom_request', id: 'r3', action: 'blur', payload: { intensity: 500 } })), env);
    expect(onIncomingEffect).toHaveBeenCalledWith('blur', 'peer-1', expect.objectContaining({
      payload: { intensity: DOM_LIMITS.intensity.max, duration: DOM_LIMITS.duration.default },
    }));
  });

  it('bounds the idempotency memory: old ids are forgotten past the cap', async () => {
    vi.useFakeTimers();
    try {
      const { deps } = makeDeps();
      const onIncomingEffect = vi.fn();
      deps.onIncomingEffect = onIncomingEffect;
      const mgr = new DominationMeshManager(deps);
      // Distinct senders so the per-sender spacing gate never masks the
      // idempotency behavior under test.
      for (let i = 0; i < DOM_LIMITS.seenCap + 5; i++) {
        mgr.handleOpened(opened(JSON.stringify({ t: 'dom_request', id: `id-${i}`, action: 'blur' }), `peer-${i}`), env);
      }
      const executed = onIncomingEffect.mock.calls.length;
      expect(executed).toBe(DOM_LIMITS.seenCap + 5);
      // The very first id was evicted, so a replay of it executes again; the
      // map itself never grows past the cap.
      vi.advanceTimersByTime(DOM_LIMITS.rateIntervalMs + 1);
      mgr.handleOpened(opened(JSON.stringify({ t: 'dom_request', id: 'id-0', action: 'blur' }), 'peer-0'), env);
      expect(onIncomingEffect.mock.calls.length).toBe(executed + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('completeWithPhoto seals the frame + completed receipt; an oversized frame fails', async () => {
    const { deps, sent } = makeDeps();
    const mgr = new DominationMeshManager(deps);
    mgr.handleOpened(opened(JSON.stringify({ t: 'dom_request', id: 'cam-1', action: 'camera' })), env);
    const ok = await mgr.completeWithPhoto('cam-1', 'data:image/jpeg;base64,ZnJhbWU=', 'Vic');
    expect(ok).toBe(true);
    const bodies = sent.map((s) => JSON.parse(s.body));
    expect(bodies).toContainEqual({ t: 'dom_photo', id: 'cam-1', data: 'data:image/jpeg;base64,ZnJhbWU=', n: 'Vic' });
    expect(bodies.at(-1)).toEqual({ t: 'dom_receipt', id: 'cam-1', status: 'completed' });

    // Fresh request from a different peer (the spacing gate is per sender),
    // oversized frame: refused, failed receipt.
    mgr.handleOpened(opened(JSON.stringify({ t: 'dom_request', id: 'cam-2', action: 'camera' }), 'peer-2'), env);
    const huge = 'data:image/jpeg;base64,' + 'A'.repeat(DOM_LIMITS.photoMaxBytes * 2);
    const ok2 = await mgr.completeWithPhoto('cam-2', huge);
    expect(ok2).toBe(false);
    expect(JSON.parse(sent.at(-1)!.body).status).toBe('failed');
  });

  it('reportExecution seals completed/failed for dispatched non-camera effects', async () => {
    const { deps, sent } = makeDeps();
    const mgr = new DominationMeshManager(deps);
    mgr.handleOpened(opened(JSON.stringify({ t: 'dom_request', id: 'e1', action: 'message', payload: { text: 'hi' } })), env);
    await mgr.reportExecution('e1', false);
    expect(JSON.parse(sent.at(-1)!.body)).toEqual({ t: 'dom_receipt', id: 'e1', status: 'failed' });
  });
});
