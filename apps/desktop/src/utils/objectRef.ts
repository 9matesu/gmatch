import { isMagnetUri } from './magnet';

/**
 * ONE parser for "what does this media reference address?".
 *
 * The rule used to be implemented five times, with three different answers:
 *
 *   utils/media.ts          resolveMediaUrl      → urn (uuid AND hex) → /api/objects/<id>
 *   utils/localMedia.ts     localHeldMediaUrl     → urn (uuid ONLY)   → id
 *   hooks/useObjectImage.ts isRequestableObjectId→ every urn is rejected
 *   components/ObjectImage  extractObjectId      → urn (uuid AND hex) → id
 *   App.tsx                 resolveWallpaperUrl   → urn (uuid ONLY)   → id
 *
 * The two "uuid only" copies were live bugs: a 64-hex `urn:sha256:<hash>`
 * wallpaper descriptor fell through to `orbitFetch('urn:sha256:…')`, a doomed
 * request against a string that is not a path. The three answers also did not
 * compose — the media ladder could resolve a ref that the request guard then
 * rejected.
 *
 * The contract (SPEC §0, 2026-11-06), stated once:
 *
 *   - A RAW descriptor is never an id. `urn:sha256:…` and `magnet:?…` must
 *     never be fired at the node as a path.
 *   - The id INSIDE a `urn:sha256:` IS the canonical object id and stays
 *     addressable — both the UUID form and the sha256-hex form.
 *   - A `magnet:` carries the CONTENT HASH the bytes are stored under (legacy rows:
 *     sha256(bytes).slice(0,40)). It is addressable LOCALLY - vault,
 *     IndexedDB, swarm by hash - but still not a node path, so
 *     isRequestableObjectId keeps refusing it.
 *
 * Two projections of the one parse:
 *   resolveObjectRefId()  → the id this ref addresses (resolves a urn)
 *   isRequestableObjectId() → is this raw value ITSELF a safe path id?
 */

export type ObjectRefKind = 'empty' | 'id' | 'urn' | 'magnet' | 'url';

export interface ParsedObjectRef {
  kind: ObjectRefKind;
  /** The trimmed reference. */
  raw: string;
  /** The canonical object id this reference addresses, when it addresses one. */
  id: string | null;
}

const OBJECT_PATH = '/api/objects/';

/** `urn:sha256:<uuid>` or `urn:sha256:<64-hex>` — the id lives inside. */
const MAGNET_BTIH_RE = /xt=urn:btih:([0-9a-f]{64}|[0-9a-f]{40})/i;

const URN_ID_RE = /^urn:sha256:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64})/i;

/** Strip the `/api/objects/` mount from a path so the bare id remains. */
export function normalizeObjectId(ref: string): string {
  if (!ref) return ref;
  if (ref.startsWith(OBJECT_PATH)) return ref.slice(OBJECT_PATH.length).split(/[?#]/)[0];
  return ref;
}

export function parseObjectRef(raw: string | null | undefined): ParsedObjectRef {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { kind: 'empty', raw: '', id: null };

  // /api/objects/<id> — the id is the last path segment.
  if (trimmed.startsWith(OBJECT_PATH)) {
    const id = trimmed.slice(OBJECT_PATH.length).split(/[?#]/)[0];
    return id ? { kind: 'id', raw: trimmed, id } : { kind: 'url', raw: trimmed, id: null };
  }

  // A urn carries the canonical object id INSIDE it.
  const urn = URN_ID_RE.exec(trimmed);
  if (urn) return { kind: 'urn', raw: trimmed, id: urn[1] };

  // A magnet is a descriptor with no addressable id.
  if (isMagnetUri(trimmed)) {
    const btih = MAGNET_BTIH_RE.exec(trimmed);
    return { kind: 'magnet', raw: trimmed, id: btih ? btih[1] : null };
  }

  // Any other urn: is a descriptor too, but one we cannot address.
  if (/^urn:/i.test(trimmed)) return { kind: 'urn', raw: trimmed, id: null };

  // Any scheme (http:, data:, blob:, vault:, gmcache:, file:) is a URL.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return { kind: 'url', raw: trimmed, id: null };

  // A path with separators or terminators is not a single id segment.
  if (/[/\\?#\s]/.test(trimmed)) return { kind: 'url', raw: trimmed, id: null };

  return { kind: 'id', raw: trimmed, id: trimmed };
}

/**
 * The canonical object id a reference addresses, or null.
 *
 * Resolves BOTH `urn:sha256:` forms. Returns null for URLs and
 * malformed descriptors — nothing is ever requested for those.
 */
export function resolveObjectRefId(raw: string | null | undefined): string | null {
  return parseObjectRef(raw).id;
}

/**
 * Can this raw value be used as an object id in a request path?
 *
 * The raw form must ALREADY be an id. A `magnet:?…` or `urn:sha256:…`
 * descriptor is what the API RETURNS for an object, never something you can
 * ask for — feeding one back as an id is silent data loss: the literal `?` in
 * `magnet:?xt=…` terminates the path, so the browser requests
 * `/api/objects/magnet:` and the node 404s on the truncated id. That 404 then
 * also fired `orbit-object-404` (which tried to delete the story row) and
 * cached a permanent failure that evicted a real entry from the 24-slot LRU.
 */
export function isRequestableObjectId(raw: string | null | undefined): boolean {
  const parsed = parseObjectRef(raw);
  if (parsed.kind !== 'id') return false;
  const id = parsed.id;
  if (!id) return false;
  // No path separators or terminators: a single path segment, nothing that can
  // split the URL.
  return !/[/\\?#\s]/.test(id);
}
