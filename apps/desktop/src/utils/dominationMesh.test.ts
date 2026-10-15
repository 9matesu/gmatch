// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  DOM_ACTION_CONSENT,
  decodeDomBody,
  encodeDomReceipt,
  encodeDomRequest,
  isActionConsented,
  newDomId,
} from './dominationMesh';

describe('dominationMesh protocol (sealed body, kind=mail)', () => {
  it('request round-trips action + payload + sender name', () => {
    const body = encodeDomRequest({
      id: 'dom-1',
      action: 'message',
      payload: { text: 'hi' },
      senderName: 'Ana',
    });
    const decoded = decodeDomBody(body);
    expect(decoded).toMatchObject({ t: 'dom_request', id: 'dom-1', action: 'message', n: 'Ana' });
    expect((decoded as { payload?: unknown }).payload).toEqual({ text: 'hi' });
  });

  it('receipt round-trips request id + landed/declined', () => {
    expect(decodeDomBody(encodeDomReceipt('dom-1', 'landed'))).toMatchObject({
      t: 'dom_receipt', id: 'dom-1', status: 'landed',
    });
    expect(decodeDomBody(encodeDomReceipt('dom-1', 'declined'))).toMatchObject({
      t: 'dom_receipt', id: 'dom-1', status: 'declined',
    });
  });

  it('rejects foreign bodies: DM, garbage, unknown action, bad receipt', () => {
    expect(decodeDomBody(JSON.stringify({ t: 'dm', id: 'x', text: 'hi' }))).toBeNull();
    expect(decodeDomBody('not json{{{')).toBeNull();
    expect(decodeDomBody(JSON.stringify({ t: 'dom_request', id: 'x', action: 'nuke' }))).toBeNull();
    expect(decodeDomBody(JSON.stringify({ t: 'dom_request', id: 5, action: 'message' }))).toBeNull();
    expect(decodeDomBody(JSON.stringify({ t: 'dom_receipt', id: 'x', status: 'maybe' }))).toBeNull();
    expect(decodeDomBody(JSON.stringify({ t: 'dom_receipt', id: 'x' }))).toBeNull();
  });

  it('consent gate: per-action key, closed by default', () => {
    expect(DOM_ACTION_CONSENT['message']).toBe('allowPopupMessage');
    expect(DOM_ACTION_CONSENT['camera']).toBe('allowRemoteCamera');
    expect(Object.keys(DOM_ACTION_CONSENT).length).toBe(7);
    // Off / missing / wrong-type all mean NO.
    expect(isActionConsented({}, 'message')).toBe(false);
    expect(isActionConsented({ allowPopupMessage: false }, 'message')).toBe(false);
    expect(isActionConsented({ allowPopupMessage: true }, 'message')).toBe(true);
    expect(isActionConsented({ allowPopupMessage: true }, 'blur')).toBe(false);
    expect(isActionConsented({ allowPopupMessage: 1 as unknown as boolean }, 'message')).toBe(false);
    expect(isActionConsented({}, 'nuke')).toBe(false);
  });

  it('ids are unique dom-prefixed', () => {
    const a = newDomId();
    const b = newDomId();
    expect(a).not.toBe(b);
    expect(a.startsWith('dom-')).toBe(true);
  });
});
