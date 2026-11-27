/**
 * Rotating infohash — the only thing a public tracker ever sees.
 *
 *   infohash = sha1( HMAC-SHA256(communityKey, "mesh:" + yyyy-mm-dd UTC) )
 *
 * It changes once a day, so a tracker operator learns "some node was here
 * today" and nothing else: no identity, no catalog, no stable fingerprint.
 *
 * The bytes (not the hex) are what the tracker wire carries: info_hash and
 * peer_id are 20-character binary strings, never hex. Sending hex there is the
 * classic bug — the tracker compares 20 bytes, not 40 characters.
 */

const PREFIX = 'mesh:';
const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** UTC calendar day, so peers in different zones agree on the window. */
export function dayStamp(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

async function hmacKey(communityKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(communityKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** 20 raw bytes of that day's infohash. */
export async function infoHashBytes(communityKey: string, date: Date = new Date()): Promise<Uint8Array> {
  const key = await hmacKey(communityKey);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${PREFIX}${dayStamp(date)}`)));
  return new Uint8Array(await crypto.subtle.digest('SHA-1', mac));
}

/** 40-char hex, for logs and tests (never for the tracker wire). */
export async function infoHashHex(communityKey: string, date: Date = new Date()): Promise<string> {
  return [...(await infoHashBytes(communityKey, date))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The three days a client announces and searches: yesterday, today, tomorrow.
 * A peer with a skewed clock (or a different UTC offset at the boundary) still
 * lands in the window.
 */
export async function infoHashWindow(communityKey: string, now: number = Date.now()): Promise<Uint8Array[]> {
  const seen = new Set<string>();
  const out: Uint8Array[] = [];
  for (const offset of [-1, 0, 1]) {
    const bytes = await infoHashBytes(communityKey, new Date(now + offset * DAY_MS));
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(bytes);
  }
  return out;
}

/**
 * JSON-escape a binary field: each byte becomes `\u00xx`, so the JSON on the
 * wire is pure ASCII and any parser rebuilds the exact 20 characters.
 *
 * `JSON.stringify` of a raw binary string emits UTF-8, which turns every byte
 * >= 0x80 into two bytes — the tracker then compares 20 bytes against more.
 */
export function binaryJson(bytes: Uint8Array): string {
  return [...bytes].map((b) => `\\u00${b.toString(16).padStart(2, '0')}`).join('');
}

/** Inverse of binaryJson: a JSON string (chars 0-255) back to bytes. */
export function binaryBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}