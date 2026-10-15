import type { Envelope, OpenedEnvelope } from '@orbit/protocol';
import {
  DOM_ACTION_CONSENT,
  decodeDomBody,
  encodeDomReceipt,
  encodeDomRequest,
  isActionConsented,
  newDomId,
} from './dominationMesh';

export interface MeshPeerKeys {
  publicKeyHex: string;
  encryptionPubHex: string;
}

export interface DominationMeshDeps {
  /** Sealed PUT into the peer's courier box (MailClient.send-compatible). */
  mail: {
    send: (body: string, to: MeshPeerKeys) => Promise<{ id: string }>;
  };
  /** Known keys only — null means the peer is not mesh-addressable and no
   *  blind PUT is ever attempted (sem fetch cego). */
  getPeerKeys: (peerOrbitId: string) => MeshPeerKeys | null;
  /** Delivery token derivation (peerAddressToken in the app, stub in tests). */
  addressPeer: (keys: MeshPeerKeys) => string;
  /** Receiver local consent map lookup (settings). */
  isConsented: (action: string) => boolean;
  /** Sender outbox flip when a receipt arrives (landed | declined). */
  onOutboxStatus: (requestId: string, status: 'landed' | 'declined') => void;
  /** Receiver render hook: a consented action arrived — show the effect. */
  onIncomingEffect: (
    action: string,
    fromOrbitId: string,
    extra?: { id: string; senderName?: string; payload?: unknown },
  ) => void;
}

/**
 * Mesh domination runtime (Fase 5/6 slice 2). Sends seal dom_request bodies
 * over the blind courier and cost nothing (no server, no ledger). Receives
 * enforce the RECEIVER's local consent: pre-consented actions land
 * immediately (+ landed receipt), the camera action waits for live approval
 * (+ receipt on land/decline), everything else gets a declined receipt.
 * Request ids are executed at most once (idempotency across retries).
 */
export class DominationMeshManager {
  private seen = new Set<string>();
  /** Requests awaiting live approval (camera): id -> return address. */
  private pending = new Map<string, MeshPeerKeys>();

  constructor(private readonly deps: DominationMeshDeps) {}

  /** Mesh-first send. Unknown keys => { ok:false } — the caller falls back
   *  to the server route; the mesh never fires blind. */
  async sendEffect(
    targetOrbitId: string,
    action: string,
    payload: unknown,
    senderName?: string,
  ): Promise<{ ok: true; id: string } | { ok: false; reason: 'no-keys' | 'unknown-action' }> {
    if (!(action in DOM_ACTION_CONSENT)) return { ok: false, reason: 'unknown-action' };
    const keys = this.deps.getPeerKeys(targetOrbitId);
    if (!keys) return { ok: false, reason: 'no-keys' };
    const id = newDomId();
    await this.deps.mail.send(
      encodeDomRequest({ id, action, payload, senderName }),
      keys,
    );
    return { ok: true, id };
  }

  /**
   * Inbound hook for opened kind='mail' envelopes. Returns true when the
   * body was domination (consumed); false leaves routing to the next layer
   * (DMs, rooms, signal).
   */
  handleOpened(opened: OpenedEnvelope, env: Envelope): boolean {
    const body = decodeDomBody(opened.body);
    if (!body) return false;

    if (body.t === 'dom_receipt') {
      this.deps.onOutboxStatus(body.id, body.status);
      return true;
    }

    // dom_request from here on.
    if (this.seen.has(body.id)) return true; // retry/echo: executed once.
    this.seen.add(body.id);

    const returnKeys: MeshPeerKeys = {
      publicKeyHex: opened.senderPubHex,
      // TOFU like DMs: the sender's X25519 enc pub rides env.fromEph.
      encryptionPubHex: env.fromEph || '',
    };

    if (!isActionConsentedFrom(this.deps.isConsented, body.action)) {
      void this.sendReceipt(returnKeys, body.id, 'declined');
      return true;
    }

    if (body.action === 'camera') {
      // Live approval per request (same posture as the server path): the UI
      // renders the ask and calls land()/decline() on user decision.
      this.pending.set(body.id, returnKeys);
      this.deps.onIncomingEffect(body.action, opened.senderOrbitId, {
        id: body.id,
        senderName: body.n,
        payload: body.payload,
      });
      return true;
    }

    this.deps.onIncomingEffect(body.action, opened.senderOrbitId, {
      id: body.id,
      senderName: body.n,
      payload: body.payload,
    });
    void this.sendReceipt(returnKeys, body.id, 'landed');
    return true;
  }

  /** Live-approve a pending camera request (receipt: landed). */
  async land(requestId: string): Promise<void> {
    const keys = this.pending.get(requestId);
    if (!keys) return;
    this.pending.delete(requestId);
    await this.sendReceipt(keys, requestId, 'landed');
  }

  /** Live-deny a pending camera request (receipt: declined). */
  async decline(requestId: string): Promise<void> {
    const keys = this.pending.get(requestId);
    if (!keys) return;
    this.pending.delete(requestId);
    await this.sendReceipt(keys, requestId, 'declined');
  }

  private async sendReceipt(
    keys: MeshPeerKeys,
    requestId: string,
    status: 'landed' | 'declined',
  ): Promise<void> {
    if (!keys.encryptionPubHex) return; // nowhere to seal to — drop silently.
    try {
      await this.deps.mail.send(encodeDomReceipt(requestId, status), keys);
    } catch { /* receipt best-effort; the sender's outbox stays authoritative */ }
  }
}

/** Adapter: the app's (action)->boolean lookup over the raw settings map. */
function isActionConsentedFrom(isConsented: (action: string) => boolean, action: string): boolean {
  try {
    return isConsented(action) === true;
  } catch {
    return false;
  }
}

// Re-exported so callers gate UI affordances with the same predicate.
export { isActionConsented };
