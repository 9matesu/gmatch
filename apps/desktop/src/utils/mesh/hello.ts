/**
 * HELLO — the first thing that crosses an open DataChannel, and the only thing
 * that authenticates it.
 *
 * The tracker is untrusted: it could hand us somebody else's SDP. So each side
 * signs a TRANSCRIPT, not just its own fingerprint:
 *
 *   sig = Ed25519(identity.priv,
 *          "mesh-hello-v1" | fp_local | fp_remote | nonce_local | nonce_remote )
 *
 * Both fingerprints and both nonces are in the signature, so a replayed HELLO
 * from another session does not verify here, and a swapped SDP breaks the DTLS
 * fingerprint match before the transcript is even checked.
 *
 * The channel is DTLS-encrypted, so sending fp/nonce in the clear first is not
 * a leak: integrity is already guaranteed by the transport, and this signature
 * is what stops an impostor the tracker pointed us at.
 */

import { signMessage, verifySignature, hexToBytes, bytesToHex } from '@orbit/crypto';
import { sha256Hex } from '@orbit/protocol';

export const HELLO_VERSION = 'mesh-hello-v1';
const NONCE_BYTES = 16;

export interface HelloPayload {
  v: number;
  orbitId: string;
  pubKeyHex: string;
  encPubHex?: string;
  /** Local DTLS fingerprint (sha-256 hex). */
  fp: string;
  /** Fresh per session, 16 random bytes hex. */
  nonce: string;
}

export interface HelloSigned extends HelloPayload {
  sig: string;
}

export interface Signer {
  orbitId: string;
  privateKeyHex: string;
  publicKeyHex: string;
  encryptionPubHex?: string;
}

export function randomNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** The exact bytes both sides sign. Order matters: it binds the two sessions. */
export function helloTranscript(hello: HelloPayload, remote: HelloPayload): Uint8Array {
  return new TextEncoder().encode([HELLO_VERSION, hello.fp, remote.fp, hello.nonce, remote.nonce].join('|'));
}

/** The sha-256 fingerprint from an SDP (what DTLS actually presents). */
export function fingerprintFromSdp(sdp: string | null | undefined): string {
  if (!sdp) return '';
  const match = sdp.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/);
  return match ? match[1].replace(/:/g, '').toLowerCase() : '';
}

/** The fingerprint this connection will present. */
export function localFingerprint(pc: RTCPeerConnection): string {
  return fingerprintFromSdp(pc.localDescription?.sdp);
}

export function makeHello(identity: Signer, fp: string): HelloPayload {
  return {
    v: 1,
    orbitId: identity.orbitId,
    pubKeyHex: identity.publicKeyHex,
    encPubHex: identity.encryptionPubHex,
    fp,
    nonce: randomNonce(),
  };
}

export function signHello(identity: Signer, hello: HelloPayload, remote: HelloPayload): HelloSigned {
  return { ...hello, sig: bytesToHex(signMessage(helloTranscript(hello, remote), identity.privateKeyHex)) };
}

/**
 * A HELLO verifies only when:
 *  - orbitId is the hash of the declared public key (no borrowed identity),
 *  - the signature covers THIS transcript (both fingerprints, both nonces),
 *  - the fields have the shape the transcript assumes.
 */
export function verifyHello(hello: HelloSigned, remote: HelloPayload): boolean {
  if (!hello?.orbitId || !hello?.pubKeyHex || !hello?.sig) return false;
  if (!/^[0-9a-f]{64}$/.test(hello.fp) || !/^[0-9a-f]{32}$/.test(hello.nonce)) return false;
  try {
    // orbitId is the hash of the key: a valid signature from an unrelated
    // account must not borrow that identity. sha256Hex takes BYTES, not hex.
    if (sha256Hex(hexToBytes(hello.pubKeyHex)) !== hello.orbitId) return false;
    return verifySignature(hexToBytes(hello.sig), helloTranscript(hello, remote), hello.pubKeyHex);
  } catch {
    return false;
  }
}

export interface HelloWire {
  send: (text: string) => void;
  /** Subscribe to channel text frames; returns an unsubscribe. */
  onMessage: (cb: (text: string) => void) => () => void;
}

export interface HelloResult {
  local: HelloSigned;
  remote: HelloSigned;
}

/**
 * Two-phase exchange over an open channel: hello (fp+nonce) → hello signed.
 * Resolves null when the far end does not verify; the caller drops the channel.
 */
export function exchangeHello(
  wire: HelloWire,
  identity: Signer,
  fp: string,
  timeoutMs = 8_000,
): Promise<HelloResult | null> {
  return new Promise((resolve) => {
    const mine = makeHello(identity, fp);
    let remoteHello: HelloPayload | null = null;
    let done = false;
    let off: () => void = () => {};
    const finish = (value: HelloResult | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    off = wire.onMessage((text) => {
      let msg: HelloSigned;
      try {
        msg = JSON.parse(text) as HelloSigned;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.pubKeyHex !== 'string') return;

      // Their fp+nonce (a signed hello carries both, so a one-way first frame
      // is enough: the transcript only needs the values, not a handshake).
      if (!remoteHello) remoteHello = msg;

      // Phase 1: unsigned hello — answer with ours, signed.
      if (!msg.sig) {
        wire.send(JSON.stringify(signHello(identity, mine, remoteHello)));
        return;
      }

      // Phase 2: their signature over our transcript.
      if (!verifyHello(msg, mine)) {
        finish(null);
        return;
      }
      finish({ local: signHello(identity, mine, remoteHello), remote: msg });
    });

    wire.send(JSON.stringify(mine));
  });
}