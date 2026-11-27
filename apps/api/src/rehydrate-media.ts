/**
 * Media rehydration: put real bytes back under archive rows that kept only a
 * descriptor.
 *
 * WHY THIS EXISTS
 *
 * The 1.4.x archive stored every post's media as a `magnet:` / `urn:` row. The
 * node kept the METADATA and the client kept the bytes, so when the client
 * store was lost the rows survived with nothing to render: the feed showed
 * "No preview" for hundreds of posts that used to have images.
 *
 * A descriptor is not bytes. This module is the one place that decides whether
 * a candidate byte run IS the bytes a row used to point at, and it only ever
 * accepts an EXACT match.
 *
 * THE TWO IDENTITY ERAS (both are real, and both are checked)
 *
 *   64-hex content_hash = sha256(bytes)                       (current scheme)
 *   40-hex content_hash = sha256(bytes).slice(0, 40)           (the old
 *                         "fake btih" scheme: the magnet's btih was the
 *                         first 20 bytes of a SHA-256 with the rest dropped)
 *
 * The second one is not a guess: the archive's magnets carry a 40-hex btih
 * that EQUALS the row's content_hash, and the desktop's vault proves the
 * relation — 44 recovered files satisfy sha256(bytes)[0:40] == content_hash
 * exactly, and NONE of them satisfy the full-sha256 relation.
 *
 * There is also an era where the OBJECT ID itself was the sha256 of the bytes.
 * That is checked too (`/^[0-9a-f]{64}$/i.test(row.id)`), because it is the
 * same claim about the same bytes, not a weaker one.
 *
 * WHAT IS NEVER ACCEPTED
 *
 *   - a candidate whose hash does not match the row (no "close enough", no
 *     same-timestamp guess, no same-caption guess)
 *   - a row with no hash at all, matched by caption or size: that would put
 *     the WRONG picture under a real post, which is worse than no picture
 *   - bytes from a remote that answered with a descriptor: that is a row, not
 *     a payload
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { signMessage } from '@orbit/crypto'
import { LocalBlobStore } from './blob'
import { decryptBlob, encryptBlob } from './crypto'

export interface ArchiveObject {
  id: string
  contentHash: string | null
  mimeType: string | null
  sizeBytes: number | null
  createdAt: string | null
  contentUrl: string | null
}

export interface RecoveryIdentity {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
  encryptionPubHex?: string
}

export interface ByteCandidate {
  /** Where the bytes came from: "vault", "imgcache", "blobdir", ... */
  source: string
  /** Human label: the file name, the URL, the object id. */
  label: string
  bytes: Uint8Array
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Does this sha256 identify the row's bytes?
 *
 * 64-hex content_hash -> the full digest. 40-hex content_hash -> the first 40
 * hex characters (the fake-btih era). Anything else is not a hash this archive
 * ever wrote, so it never matches.
 */
export function archiveHashMatches(digest: string, contentHash: string | null | undefined): boolean {
  const expected = (contentHash || '').trim().toLowerCase()
  if (!expected) return false
  const actual = digest.trim().toLowerCase()
  if (expected.length === 64) return actual === expected
  if (expected.length === 40) return actual.startsWith(expected)
  return false
}

/**
 * Every identity claim a row makes about its bytes, checked in one place.
 *
 * The object id counts only when it is a 64-hex string, which is the era
 * where the id WAS the sha256 of the payload.
 */
export function candidateIdentifiesRow(digest: string, row: ArchiveObject): boolean {
  if (archiveHashMatches(digest, row.contentHash)) return true
  const id = (row.id || '').toLowerCase()
  if (/^[0-9a-f]{64}$/.test(id) && digest.toLowerCase() === id) return true
  return false
}

/** The btih a magnet names, or null. Used to cross-check the fake-btih era. */
export function btihFromMagnet(url: string | null | undefined): string | null {
  if (!url || !/^magnet:/i.test(url.trim())) return null
  const m = /[?&]xt=urn:btih:([0-9a-fA-F]{40})/i.exec(url)
  return m ? m[1].toLowerCase() : null
}

/* ------------------------------------------------------------------ *
 * Local byte sources
 * ------------------------------------------------------------------ */

export interface VaultManifestEntry {
  storeKey: string
  file: string
  mime: string
  bytes: number
  encrypted: boolean
  hash: string | null
}

/**
 * Read the desktop vault's manifest.
 *
 * The manifest is the map that the old builds left behind: storeKey -> file,
 * mime, byte count, encrypted flag and content hash. It is also the only
 * surviving record of the ORIGINAL provider URL (the store key), which is
 * what makes a re-download possible for media the vault no longer holds.
 */
export function readVaultManifest(vaultDir: string): VaultManifestEntry[] {
  const manifestPath = join(vaultDir, 'manifest.json')
  let raw: any
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return []
  }
  if (!raw || typeof raw !== 'object') return []
  const out: VaultManifestEntry[] = []
  for (const [storeKey, e] of Object.entries(raw as Record<string, any>)) {
    if (!e || typeof e !== 'object') continue
    const file = typeof (e.file || e.key) === 'string' ? (e.file || e.key) : null
    if (!file) continue
    out.push({
      storeKey,
      file,
      mime: String(e.mime || ''),
      bytes: Number(e.bytes) || 0,
      encrypted: Boolean(e.enc),
      hash: typeof e.hash === 'string' ? e.hash.toLowerCase() : null,
    })
  }
  return out
}

/**
 * The bytes of one vault entry.
 *
 * Encrypted entries are decrypted with the install's storage key (the same
 * AES-256-GCM envelope as the API's blob store: iv | tag | ciphertext). A
 * legacy entry that cannot be decrypted is skipped, never guessed at.
 */
export function readVaultEntryBytes(
  vaultDir: string,
  entry: VaultManifestEntry,
  keyHex: string | null,
): Uint8Array | null {
  const filePath = join(vaultDir, entry.file)
  let raw: Buffer
  try {
    raw = readFileSync(filePath)
  } catch {
    return null
  }
  if (!entry.encrypted) return new Uint8Array(raw)
  if (!keyHex) return null
  try {
    return decryptBlob(new Uint8Array(raw), keyHex)
  } catch {
    return null
  }
}

/** Every readable byte run in the desktop vault, verified against its manifest hash. */
export function readVaultCandidates(vaultDir: string, keyHex: string | null): ByteCandidate[] {
  const out: ByteCandidate[] = []
  for (const entry of readVaultManifest(vaultDir)) {
    const bytes = readVaultEntryBytes(vaultDir, entry, keyHex)
    if (!bytes || bytes.length === 0) continue
    const digest = sha256Hex(bytes)
    // The manifest's hash is the store's own claim; when it disagrees with the
    // bytes on disk the entry is damaged and must not be used.
    if (entry.hash && entry.hash !== digest) continue
    out.push({ source: 'vault', label: entry.storeKey || entry.file, bytes })
  }
  return out
}

/**
 * Every readable byte run in the encrypted picture LRU (imgcache/*.enc).
 *
 * The LRU has no manifest, so nothing is claimed about these bytes beyond
 * their digest — which is exactly what the matching needs.
 */
export function readEncryptedCacheCandidates(dir: string, keyHex: string | null): ByteCandidate[] {
  if (!keyHex) return []
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.enc'))
  } catch {
    return []
  }
  const out: ByteCandidate[] = []
  for (const f of files) {
    let raw: Buffer
    try {
      raw = readFileSync(join(dir, f))
    } catch {
      continue
    }
    try {
      out.push({ source: 'imgcache', label: f, bytes: decryptBlob(new Uint8Array(raw), keyHex) })
    } catch {
      /* unreadable entry: skip it */
    }
  }
  return out
}

/** Every byte run in a flat blob directory (a node's blob store). */
export function readBlobDirCandidates(dir: string): ByteCandidate[] {
  let files: string[] = []
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }
  const out: ByteCandidate[] = []
  for (const f of files) {
    const full = join(dir, f)
    try {
      if (!statSync(full).isFile()) continue
      out.push({ source: 'blobdir', label: f, bytes: new Uint8Array(readFileSync(full)) })
    } catch {
      /* skip */
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Chromium's IndexedDB external blob store
 * ------------------------------------------------------------------ */

/**
 * The desktop profile's IndexedDB keeps media in Chromium's EXTERNAL blob
 * store (`IndexedDB/<origin>.indexeddb.blob/<db>/<dir>/<file>`). Each file
 * is a structured clone of one record:
 *
 *   { id, name, mime_type, size_bytes, owner_id, created_at, data: Blob }
 *
 * The Blob's bytes are INLINE, preceded by 'B' (0x42) and a LEB128 varint
 * length — so the byte range is exact and needs no format guessing.
 *
 * Blink encodes a property name as 0x22 <len> <name> and a string value as
 * 0x22 <len> <chars>; that is what the two readers below look for.
 */

/** How far into a clone the property header can reach. */
const CLONE_HEADER_LIMIT = 4096

function cloneNamePattern(name: string): Buffer {
  return Buffer.concat([Buffer.from([0x22, name.length]), Buffer.from(name, 'latin1')])
}

/** A string property of a Blink structured clone. */
export function readCloneString(buf: Buffer, name: string): string | null {
  const at = buf.indexOf(cloneNamePattern(name), 0, CLONE_HEADER_LIMIT)
  if (at < 0) return null
  const valueMarker = buf[at + name.length + 2]
  if (valueMarker !== 0x22) return null
  const len = buf[at + name.length + 3]
  if (len === undefined || len > 255) return null
  const start = at + name.length + 4
  return buf.subarray(start, start + len).toString('latin1')
}

/** LEB128 varint at `at`. */
function readCloneVarint(buf: Buffer, at: number): { value: number; next: number } | null {
  let value = 0
  let shift = 0
  for (let i = 0; i < 10; i++) {
    const byte = buf[at + i]
    if (byte === undefined) return null
    value += (byte & 0x7f) * Math.pow(2, shift)
    if ((byte & 0x80) === 0) return { value, next: at + i + 1 }
    shift += 7
  }
  return null
}

/** The inline Blob of a Blink structured clone ('B' + varint length + bytes). */
export function readCloneBlob(buf: Buffer): Uint8Array | null {
  const at = buf.indexOf(cloneNamePattern('data'), 0, CLONE_HEADER_LIMIT)
  if (at < 0) return null
  const marker = buf[at + 6]
  if (marker !== 0x42) return null
  const v = readCloneVarint(buf, at + 7)
  if (!v || v.value <= 0) return null
  const end = v.next + v.value
  if (end > buf.length) return null
  return new Uint8Array(buf.subarray(v.next, end))
}

/** One record of the external blob store. */
export interface IndexedDbRecord {
  id: string | null
  mimeType: string | null
  bytes: Uint8Array
}

/** Parse one external blob file into its record. */
export function parseIndexedDbRecord(buf: Buffer): IndexedDbRecord | null {
  const bytes = readCloneBlob(buf)
  if (!bytes || bytes.length === 0) return null
  return {
    id: readCloneString(buf, 'id'),
    mimeType: readCloneString(buf, 'mime_type'),
    bytes,
  }
}

function walkFiles(dir: string): string[] {
  const out: string[] = []
  let entries: any[] = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

/**
 * Which digests the caller still needs. The blob store is hundreds of MB, so
 * the reader keeps only the runs that could satisfy a target row.
 */
export interface IndexedDbWanted {
  /** Full sha256 digests (64 hex). */
  full?: Set<string>
  /** The old fake-btih prefixes (40 hex). */
  prefix?: Set<string>
}

/**
 * Every readable media run in Chromium's IndexedDB external blob store.
 *
 * The bytes are returned unproven: the caller still has to prove them
 * against a row's hash (see `candidateIdentifiesRow`).
 */
export function readIndexedDbCandidates(dir: string, wanted?: IndexedDbWanted): ByteCandidate[] {
  const out: ByteCandidate[] = []
  for (const file of walkFiles(dir)) {
    let raw: Buffer
    try {
      if (!statSync(file).isFile()) continue
      raw = readFileSync(file)
    } catch {
      continue
    }
    const record = parseIndexedDbRecord(raw)
    if (!record) continue
    if (wanted && (wanted.full?.size || wanted.prefix?.size)) {
      const digest = sha256Hex(record.bytes)
      const keepFull = wanted.full?.has(digest) ?? false
      const keepPrefix = wanted.prefix?.has(digest.slice(0, 40)) ?? false
      if (!keepFull && !keepPrefix) continue
    }
    out.push({ source: 'indexeddb', label: file, bytes: record.bytes })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Remote byte sources
 * ------------------------------------------------------------------ */

export interface RemoteFetchResult {
  status: number
  bytes: Uint8Array | null
  mimeType: string | null
  /** True when the remote answered with a descriptor instead of bytes. */
  descriptor: boolean
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Signed GET for one object's bytes.
 *
 * The signature covers the PATHNAME only (no query string): the node verifies
 * the path it is about to serve, and a signed query string is a different
 * string than the path it routes on.
 */
export async function fetchRemoteObject(
  base: string,
  id: string,
  identity: RecoveryIdentity | null,
  timeoutMs = 20000,
): Promise<RemoteFetchResult> {
  const pathname = `/api/objects/${id}`
  const url = base.replace(/\/+$/, '') + pathname
  const headers: Record<string, string> = {}
  if (identity) {
    const ts = Date.now().toString()
    const payload = `GET|${pathname}|${ts}|`
    headers['X-Orbit-Id'] = identity.orbitId
    headers['X-Orbit-Timestamp'] = ts
    headers['X-Orbit-Signature'] = toHex(signMessage(new TextEncoder().encode(payload), identity.privateKeyHex))
    headers['X-Orbit-PubKey'] = identity.publicKeyHex
    if (identity.encryptionPubHex) headers['X-Orbit-PubKey-Enc'] = identity.encryptionPubHex
  }
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    const contentType = res.headers.get('content-type') || ''
    // A failed answer is an ERROR BODY, not a payload. Reading it as bytes
    // would install `{"error":"Object not found"}` as the post's media.
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined)
      return { status: res.status, bytes: null, mimeType: contentType || null, descriptor: false }
    }
    if (contentType.includes('application/json')) {
      await res.arrayBuffer()
      return { status: res.status, bytes: null, mimeType: contentType, descriptor: true }
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    return { status: res.status, bytes, mimeType: contentType || null, descriptor: false }
  } catch {
    return { status: 0, bytes: null, mimeType: null, descriptor: false }
  }
}

/* ------------------------------------------------------------------ *
 * The campaign
 * ------------------------------------------------------------------ */

export interface RehydrateOptions {
  rows: ArchiveObject[]
  bucket: LocalBlobStore
  /** Local byte runs, already read and decrypted. */
  candidates?: ByteCandidate[]
  /** Remote nodes to ask for bytes by object id. */
  remotes?: { base: string; identity?: RecoveryIdentity | null }[]
  /** Does this node already hold bytes for the row? */
  hasBytes?: (id: string) => Promise<boolean>
  /** Report only: never write. */
  dryRun?: boolean
}

export type RecoveryOutcome =
  | 'already-present'
  | 'recovered-local'
  | 'recovered-remote'
  | 'no-bytes'
  | 'hash-mismatch'
  | 'write-failed'

export interface RecoveryEntry {
  id: string
  outcome: RecoveryOutcome
  source?: string
  label?: string
  bytes?: number
  reason?: string
}

export interface RehydrateReport {
  total: number
  alreadyPresent: number
  recovered: number
  written: number
  failed: number
  entries: RecoveryEntry[]
}

export async function rehydrateMedia(opts: RehydrateOptions): Promise<RehydrateReport> {
  const candidates = opts.candidates || []
  const remotes = opts.remotes || []
  const report: RehydrateReport = {
    total: opts.rows.length,
    alreadyPresent: 0,
    recovered: 0,
    written: 0,
    failed: 0,
    entries: [],
  }

  // Index the local candidates by the identities they could satisfy, so a row
  // is matched by a hash lookup instead of a scan over every file.
  const byFull = new Map<string, ByteCandidate>()
  const byPrefix = new Map<string, ByteCandidate[]>()
  for (const c of candidates) {
    const digest = sha256Hex(c.bytes)
    if (!byFull.has(digest)) byFull.set(digest, c)
    const p40 = digest.slice(0, 40)
    const list = byPrefix.get(p40) || []
    list.push(c)
    byPrefix.set(p40, list)
  }

  for (const row of opts.rows) {
    if (opts.hasBytes && (await opts.hasBytes(row.id))) {
      report.alreadyPresent++
      report.entries.push({ id: row.id, outcome: 'already-present' })
      continue
    }

    let found: ByteCandidate | null = null
    const expected = (row.contentHash || '').toLowerCase()
    if (expected.length === 64) {
      found = byFull.get(expected) || null
    } else if (expected.length === 40) {
      const list = byPrefix.get(expected) || []
      found = list.find((c) => candidateIdentifiesRow(sha256Hex(c.bytes), row)) || null
    }
    if (!found) {
      const id = (row.id || '').toLowerCase()
      if (/^[0-9a-f]{64}$/.test(id)) found = byFull.get(id) || null
    }

    if (found) {
      report.recovered++
      const entry: RecoveryEntry = {
        id: row.id,
        outcome: 'recovered-local',
        source: found.source,
        label: found.label,
        bytes: found.bytes.length,
      }
      if (!opts.dryRun) {
        try {
          await opts.bucket.put(`objects/${row.id}`, encryptBlob(found.bytes))
          report.written++
        } catch (err) {
          entry.outcome = 'write-failed'
          entry.reason = (err as Error)?.message || String(err)
          report.failed++
          report.recovered--
        }
      }
      report.entries.push(entry)
      continue
    }

    // Nothing local. Ask the remotes for this object id.
    let remoteEntry: RecoveryEntry | null = null
    let remoteBytes: Uint8Array | null = null
    for (const remote of remotes) {
      const res = await fetchRemoteObject(remote.base, row.id, remote.identity || null)
      if (!res.bytes || res.bytes.length === 0) continue
      const digest = sha256Hex(res.bytes)
      // A remote that answers with bytes for an id it owns is authoritative
      // for that id, but a row that CARRIES a hash must still agree with it:
      // a remote serving the wrong file under a right id is exactly the
      // corruption this campaign must not install.
      if (row.contentHash && !candidateIdentifiesRow(digest, row)) {
        remoteEntry = {
          id: row.id,
          outcome: 'hash-mismatch',
          source: remote.base,
          bytes: res.bytes.length,
          reason: `sha256 ${digest.slice(0, 12)} does not match content_hash ${expected.slice(0, 12)}`,
        }
        continue
      }
      remoteBytes = res.bytes
      remoteEntry = {
        id: row.id,
        outcome: 'recovered-remote',
        source: remote.base,
        label: res.mimeType || undefined,
        bytes: res.bytes.length,
      }
      break
    }

    if (!remoteBytes) {
      if (remoteEntry) {
        report.failed++
        report.entries.push(remoteEntry)
      } else {
        report.entries.push({ id: row.id, outcome: 'no-bytes' })
      }
      continue
    }

    report.recovered++
    if (!opts.dryRun) {
      try {
        await opts.bucket.put(`objects/${row.id}`, encryptBlob(remoteBytes))
        report.written++
      } catch (err) {
        remoteEntry!.outcome = 'write-failed'
        remoteEntry!.reason = (err as Error)?.message || String(err)
        report.failed++
        report.recovered--
      }
    }
    report.entries.push(remoteEntry!)
  }

  return report
}

/** Rows that are missing bytes: descriptor rows with no blob behind them. */
export async function selectArchiveRows(
  all: ArchiveObject[],
  hasBytes: (id: string) => Promise<boolean>,
): Promise<ArchiveObject[]> {
  const out: ArchiveObject[] = []
  for (const row of all) {
    const descriptor =
      !row.contentUrl ||
      row.contentUrl.startsWith('magnet:') ||
      row.contentUrl.startsWith('urn:') ||
      row.contentUrl.startsWith('/api/objects/')
    if (!descriptor) continue
    if (await hasBytes(row.id)) continue
    out.push(row)
  }
  return out
}


