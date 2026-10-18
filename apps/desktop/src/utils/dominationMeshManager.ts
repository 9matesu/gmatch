import type { Envelope, OpenedEnvelope } from '@orbit/protocol';
import {
  DOM_LIMITS,
  DOM_ACTION_CONSENT,
  decodeDomBody,
  encodeDomPhoto,
  encodeDomReceipt,
  encodeDomRequest,
  isActionConsented,
  newDomId,
  validateDomPayload,
  type DomReceiptStatus,
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
  /** Sender outbox flip when a receipt arrives. Statuses cover the whole
   *  lifecycle: landed (consented+received) -> completed | failed (execution
   *  outcome), declined (receiver refused), expired (drained too late). */
  onOutboxStatus: (requestId: string, status: DomReceiptStatus) => void;
  /** Receiver render hook: a consented action arrived — show the effect. */
  onIncomingEffect: (
    action: string,
    fromOrbitId: string,
    extra?: { id: string; senderName?: string; payload?: unknown },
  ) => void;
  /** Sender hook: the captured frame for our camera request arrived. */
  onIncomingPhoto?: (
    requestId: string,
    fromOrbitId: string,
    dataUrl: string,
    senderName?: string,
  ) => void;
}

/**
 * Mesh domination runtime. Sends seal dom_request bodies over the blind
 * courier and cost nothing (no server, no ledger). Receives enforce the
 * RECEIVER's local consent: pre-consented actions land immediately (+ landed
 * receipt), the camera action waits for live approval, everything else gets a
 * declined receipt.
 *
 * Hardening wave: payload schemas are validated + clamped on BOTH sides, every
 * request carries a hard expiry, per-sender sends are spaced (server-mirror
 * cooldown), the idempotency memory is bounded, and the renderer reports the
 * real execution outcome back so the sender's outbox shows completed/failed —
 * never a fabricated success for a queued or consented request.
 */
export class DominationMeshManager {
  /** Bounded idempotency memory: insertion-ordered ids, oldest evicted. */
  private seen = new Set<string>();
  /** Requests awaiting live approval (camera): id -> return address. */
  private pending = new Map<string, MeshPeerKeys>();
  /** Consented effects handed to the renderer, until the execution outcome
   *  arrives: id -> return address (so completed/failed can be sealed). */
  private rendering = new Map<string, { keys: MeshPeerKeys; at: number }>();
  /** Per-sender+action last-send ms, for the receiver-side spacing gate. */
  private lastFromSender = new Map<string, number>();

  constructor(private readonly deps: DominationMeshDeps) {}

  /** Mesh-first send. Unknown keys => { ok:false } — the caller falls back
   *  to the server route; the mesh never fires blind. The payload is
   *  validated + clamped BEFORE sealing, so a malformed send fails loud here
   *  instead of being dropped by the receiver. */
  async sendEffect(
    targetOrbitId: string,
    action: string,
    payload: unknown,
    senderName?: string,
  ): Promise<
    | { ok: true; id: string }
    | { ok: false; reason: 'no-keys' | 'unknown-action' | 'invalid-payload' }
  > {
    if (!(action in DOM_ACTION_CONSENT)) return { ok: false, reason: 'unknown-action' };
    const keys = this.deps.getPeerKeys(targetOrbitId);
    if (!keys) return { ok: false, reason: 'no-keys' };
    const checked = validateDomPayload(action, payload);
    if (!checked.ok) return { ok: false, reason: 'invalid-payload' };
    const id = newDomId();
    await this.deps.mail.send(
      encodeDomRequest({
        id,
        action,
        payload: checked.payload,
        senderName,
        exp: Date.now() + DOM_LIMITS.requestTtl.default,
      }),
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

    if (body.t === 'dom_photo') {
      this.deps.onIncomingPhoto?.(body.id, opened.senderOrbitId, body.data, body.n);
      return true;
    }

    // dom_request from here on.
    if (this.seen.has(body.id)) return true; // retry/echo: executed once.
    this.rememberSeen(body.id);

    const returnKeys: MeshPeerKeys = {
      publicKeyHex: opened.senderPubHex,
      // TOFU like DMs: the sender's X25519 enc pub rides env.fromEph.
      encryptionPubHex: env.fromEph || '',
    };

    // Expired: drained from a courier box too late — refuse, never execute.
    if (typeof body.exp === 'number' && Date.now() > body.exp) {
      void this.sendReceipt(returnKeys, body.id, 'expired');
      return true;
    }

    if (!isActionConsentedFrom(this.deps.isConsented, body.action)) {
      void this.sendReceipt(returnKeys, body.id, 'declined');
      return true;
    }

    // Receiver-side spacing gate (server-mirror cooldown): one misbehaving
    // peer cannot flood the screen through the mesh either.
    if (!this.admitByRate(opened.senderOrbitId, body.action)) {
      void this.sendReceipt(returnKeys, body.id, 'declined');
      return true;
    }

    // The payload the renderer sees has already passed the shared schema, so
    // no unvalidated number/url/text can reach a side effect.
    const checked = validateDomPayload(body.action, body.payload);
    if (!checked.ok) {
      void this.sendReceipt(returnKeys, body.id, 'failed');
      return true;
    }

    if (body.action === 'camera') {
      // Live approval per request (same posture as the server path): the UI
      // renders the ask and calls land()/decline() on user decision. The
      // receipt only fires once the frame is actually delivered (completed)
      // or the capture fails (failed) — approval alone is not success.
      while (this.pending.size >= DOM_LIMITS.pendingCameraCap) {
        const oldest = this.pending.keys().next().value;
        if (oldest === undefined) break;
        const keys = this.pending.get(oldest);
        this.pending.delete(oldest);
        if (keys) void this.sendReceipt(keys, oldest, 'declined');
      }
      this.pending.set(body.id, returnKeys);
      this.deps.onIncomingEffect(body.action, opened.senderOrbitId, {
        id: body.id,
        senderName: body.n,
        payload: checked.payload,
      });
      return true;
    }

    this.deps.onIncomingEffect(body.action, opened.senderOrbitId, {
      id: body.id,
      senderName: body.n,
      payload: checked.payload,
    });
    // Remember the return address so the renderer's execution outcome can be
    // sealed back — the outbox distinguishes delivered from executed.
    this.rememberRendering(body.id, returnKeys);
    void this.sendReceipt(returnKeys, body.id, 'landed');
    return true;
  }

  /** Live-approve a pending camera request: keep the return address until the
   *  frame is captured, then completeWithPhoto() closes the loop. */
  async land(requestId: string): Promise<void> {
    // Kept for API compat: approval alone no longer reports success — the
    // execution report does. Nothing to do here but keep the pending entry.
  }

  /** Live-deny a pending camera request (receipt: declined). */
  async decline(requestId: string): Promise<void> {
    const keys = this.pending.get(requestId);
    if (!keys) return;
    this.pending.delete(requestId);
    await this.sendReceipt(keys, requestId, 'declined');
  }

  /** The renderer executed (or failed to execute) a consented request. Seals
   *  the real outcome back; for camera requests it also closes the pending
   *  entry. The outbox never reports success off a queue-or-consent event. */
  async reportExecution(requestId: string, ok: boolean): Promise<void> {
    const pendingKeys = this.pending.get(requestId);
    if (pendingKeys) {
      // Camera outcomes arrive via completeWithPhoto (the frame IS the
      // success); a bare failed report still closes the pending entry.
      this.pending.delete(requestId);
      if (!ok) await this.sendReceipt(pendingKeys, requestId, 'failed');
      return;
    }
    const rendering = this.rendering.get(requestId);
    if (!rendering) return;
    this.rendering.delete(requestId);
    await this.sendReceipt(rendering.keys, requestId, ok ? 'completed' : 'failed');
  }

  /** Seal the captured camera frame back to the requesting peer, then report
   *  completed. The photo rides the same sealed transport — no server media
   *  store, no unsigned URL, nothing for a courier to read. */
  async completeWithPhoto(requestId: string, dataUrl: string, senderName?: string): Promise<boolean> {
    const keys = this.pending.get(requestId);
    this.pending.delete(requestId);
    if (!keys || !keys.encryptionPubHex) return false;
    if (dataUrl.length > Math.ceil((DOM_LIMITS.photoMaxBytes * 4) / 3) + 128) {
      await this.sendReceipt(keys, requestId, 'failed');
      return false;
    }
    try {
      await this.deps.mail.send(encodeDomPhoto({ id: requestId, data: dataUrl, senderName }), keys);
      await this.sendReceipt(keys, requestId, 'completed');
      return true;
    } catch {
      await this.sendReceipt(keys, requestId, 'failed');
      return false;
    }
  }

  /** Sender-side answer to "where do the keys for this request live?" — the
   *  renderer needs them to seal a photo without owning the key store. */
  keysForRequest(requestId: string): MeshPeerKeys | null {
    return this.pending.get(requestId) ?? null;
  }

  /** Remember the return address of a dispatched effect, bounded + swept by
   *  age (a renderer that never reports must not leak the map). */
  private rememberRendering(id: string, keys: MeshPeerKeys): void {
    this.rendering.set(id, { keys, at: Date.now() });
    const ttl = DOM_LIMITS.requestTtl.max;
    for (const [rid, entry] of this.rendering) {
      if (Date.now() - entry.at > ttl) this.rendering.delete(rid);
    }
    while (this.rendering.size > DOM_LIMITS.seenCap) {
      const oldest = this.rendering.keys().next().value;
      if (oldest === undefined) break;
      this.rendering.delete(oldest);
    }
  }

  private async sendReceipt(keys: MeshPeerKeys, requestId: string, status: DomReceiptStatus): Promise<void> {
    if (!keys.encryptionPubHex) return; // nowhere to seal to — drop silently.
    try {
      await this.deps.mail.send(encodeDomReceipt(requestId, status), keys);
    } catch { /* receipt best-effort; the sender's outbox stays authoritative */ }
  }

  /** Bounded idempotency: remember the id, evict the oldest past the cap. */
  private rememberSeen(id: string): void {
    this.seen.add(id);
    while (this.seen.size > DOM_LIMITS.seenCap) {
      const oldest = this.seen.values().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }

  /** Per-sender+action spacing. Returns false when the same peer re-sends the
   *  same action inside the cooldown window. */
  private admitByRate(senderOrbitId: string, action: string): boolean {
    const key = `${senderOrbitId}:${action}`;
    const now = Date.now();
    const last = this.lastFromSender.get(key) ?? 0;
    if (now - last < DOM_LIMITS.rateIntervalMs) return false;
    this.lastFromSender.set(key, now);
    while (this.lastFromSender.size > DOM_LIMITS.seenCap) {
      const oldest = this.lastFromSender.keys().next().value;
      if (oldest === undefined) break;
      this.lastFromSender.delete(oldest);
    }
    return true;
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
