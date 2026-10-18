// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DominationMeshManager } from './dominationMeshManager';

const KEYS = { publicKeyHex: 'peer-pub', encryptionPubHex: 'peer-enc' };

function setup(consents: Record<string, boolean> = {}) {
  const sent: Array<{ body: string; to: typeof KEYS }> = [];
  const mail = {
    send: vi.fn(async (body: string, to: typeof KEYS) => {
      sent.push({ body, to });
      return { id: `env-${sent.length}` };
    }),
  };
  const effects: Array<{ action: string; from: string }> = [];
  const statuses: Array<{ id: string; status: string }> = [];
  const mgr = new DominationMeshManager({
    mail,
    getPeerKeys: (id: string) => (id === 'peer-1' ? KEYS : null),
    addressPeer: () => 'token-peer-1',
    isConsented: (action: string) => consents[action] === true,
    onOutboxStatus: (id: string, status: string) => { statuses.push({ id, status }); },
    onIncomingEffect: (action: string, from: string) => { effects.push({ action, from }); },
  });
  return { mgr, mail, sent, effects, statuses };
}

const opened = (body: string, from = 'peer-1') => ({
  kind: 'mail' as const,
  id: 'env-in-1',
  to: 'token-me',
  body,
  senderPubHex: 'peer-pub',
  senderOrbitId: from,
});
const env = { v: 2 as const, kind: 'mail' as const, to: 'token-me', id: 'env-in-1', sealed: 'x', fromEph: 'peer-enc' };

describe('DominationMeshManager', () => {
  it('sendEffect: seals request via mail, no keys => no blind PUT', async () => {
    const { mgr, mail } = setup();
    const r = await mgr.sendEffect('peer-1', 'message', { text: 'hi' }, 'Me');
    expect(r.ok).toBe(true);
    expect(mail.send).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mail.send.mock.calls[0][0] as string);
    expect(body).toMatchObject({ t: 'dom_request', action: 'message' });
    expect(typeof body.id).toBe('string');

    const r2 = await mgr.sendEffect('stranger-9', 'message', {}, 'Me');
    expect(r2).toEqual({ ok: false, reason: 'no-keys' });
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('inbound consented action: effect fires + landed receipt sealed back', async () => {
    const { mgr, effects, sent } = setup({ message: true });
    const body = JSON.stringify({ t: 'dom_request', id: 'dom-7', action: 'message', payload: { text: 'hi' } });
    expect(mgr.handleOpened(opened(body), env)).toBe(true);
    expect(effects).toEqual([{ action: 'message', from: 'peer-1' }]);
    const receipt = JSON.parse(sent[0].body);
    expect(receipt).toEqual({ t: 'dom_receipt', id: 'dom-7', status: 'landed' });
  });

  it('inbound non-consented action: declined receipt, no effect', async () => {
    const { mgr, effects, sent } = setup({ message: false });
    const body = JSON.stringify({ t: 'dom_request', id: 'dom-8', action: 'message' });
    expect(mgr.handleOpened(opened(body), env)).toBe(true);
    expect(effects).toEqual([]);
    expect(JSON.parse(sent[0].body)).toEqual({ t: 'dom_receipt', id: 'dom-8', status: 'declined' });
  });

  it('duplicate request id executes once (idempotency)', async () => {
    const { mgr, effects, mail } = setup({ message: true });
    const body = JSON.stringify({ t: 'dom_request', id: 'dom-9', action: 'message', payload: { text: 'boo' } });
    mgr.handleOpened(opened(body), env);
    mgr.handleOpened(opened(body), env);
    expect(effects.length).toBe(1);
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('payload-less message is refused (failed receipt), never silently rendered', async () => {
    const { mgr, effects, sent } = setup({ message: true });
    const body = JSON.stringify({ t: 'dom_request', id: 'dom-11', action: 'message' });
    mgr.handleOpened(opened(body), env);
    expect(effects).toEqual([]);
    expect(JSON.parse(sent[0].body)).toEqual({ t: 'dom_receipt', id: 'dom-11', status: 'failed' });
  });

  it('foreign bodies are not consumed', () => {
    const { mgr } = setup({ message: true });
    expect(mgr.handleOpened(opened(JSON.stringify({ t: 'dm', id: 'x' })), env)).toBe(false);
    expect(mgr.handleOpened(opened('garbage'), env)).toBe(false);
  });

  it('receipt flips outbox status by request id', () => {
    const { mgr, statuses } = setup();
    const body = JSON.stringify({ t: 'dom_receipt', id: 'dom-3', status: 'landed' });
    expect(mgr.handleOpened(opened(body), env)).toBe(true);
    expect(statuses).toEqual([{ id: 'dom-3', status: 'landed' }]);
  });

  it('camera waits for live approval: approval alone seals nothing; the frame seals dom_photo + completed', async () => {
    const { mgr, effects, sent } = setup({ camera: true });
    const body = JSON.stringify({ t: 'dom_request', id: 'dom-10', action: 'camera' });
    expect(mgr.handleOpened(opened(body), env)).toBe(true);
    expect(effects).toEqual([{ action: 'camera', from: 'peer-1' }]);
    expect(sent.length).toBe(0);
    // Approval keeps the return address but seals NOTHING yet — success is
    // the delivered frame, not the consent.
    await mgr.land('dom-10');
    expect(sent.length).toBe(0);
    const delivered = await mgr.completeWithPhoto('dom-10', 'data:image/jpeg;base64,Zg==', 'Vic');
    expect(delivered).toBe(true);
    const bodies = sent.map((s) => JSON.parse(s.body));
    expect(bodies).toContainEqual({ t: 'dom_photo', id: 'dom-10', data: 'data:image/jpeg;base64,Zg==', n: 'Vic' });
    expect(bodies.at(-1)).toEqual({ t: 'dom_receipt', id: 'dom-10', status: 'completed' });
  });
});
