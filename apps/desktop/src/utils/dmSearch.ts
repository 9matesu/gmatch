/**
 * Local DM / room message search.
 *
 * Everything here reads bytes that are ALREADY on this device (courier
 * threads and sealed rooms persist locally). There is no remote query and no
 * claim to one: results are local-only by construction, which is why the UI
 * can offer search while a peer is offline.
 *
 * The index is bounded so a decade of chat cannot be loaded into memory on a
 * keystroke. It is built newest-first and stops at `DM_SEARCH_MAX_INDEX`; the
 * cap is reported honestly by `truncated` rather than silently hiding the
 * older tail.
 */

export const DM_SEARCH_MAX_INDEX = 5_000
export const DM_SEARCH_MAX_RESULTS = 50

export interface SearchableMessage {
  id: string
  text: string
  ts: number
  /** Optionally hidden: a tombstone has no text, but keep the type explicit. */
  deletedTs?: number
}

export interface IndexedMessage<M extends SearchableMessage> {
  peerId: string
  message: M
}

export interface DmSearchHit {
  peerId: string
  messageId: string
  text: string
  ts: number
}

export interface DmSearchResult {
  hits: DmSearchHit[]
  /** True when the archive was larger than the index budget. */
  truncated: boolean
}

/** Flatten threads into one bounded, newest-first index. */
export function buildDmSearchIndex<M extends SearchableMessage>(
  threads: Record<string, readonly M[] | undefined>,
  max: number = DM_SEARCH_MAX_INDEX,
): { index: IndexedMessage<M>[]; truncated: boolean } {
  const all: IndexedMessage<M>[] = []
  for (const [peerId, list] of Object.entries(threads)) {
    if (!Array.isArray(list)) continue
    for (const message of list) {
      if (!message || typeof message.id !== 'string') continue
      all.push({ peerId, message })
    }
  }
  all.sort((a, b) => (b.message.ts || 0) - (a.message.ts || 0))
  return { index: all.slice(0, Math.max(0, max)), truncated: all.length > max }
}

function normaliseQuery(query: string): string {
  return query.trim().toLowerCase()
}

/** Search the bounded index. Newest match first, at most `limit` hits. */
export function searchDmIndex<M extends SearchableMessage>(
  index: readonly IndexedMessage<M>[],
  query: string,
  limit: number = DM_SEARCH_MAX_RESULTS,
): DmSearchHit[] {
  const q = normaliseQuery(query)
  if (q.length < 2) return []
  const hits: DmSearchHit[] = []
  for (const entry of index) {
    if (hits.length >= limit) break
    const text = entry.message.text || ''
    if (!text || entry.message.deletedTs) continue
    if (!text.toLowerCase().includes(q)) continue
    hits.push({
      peerId: entry.peerId,
      messageId: entry.message.id,
      text,
      ts: entry.message.ts,
    })
  }
  return hits
}

/** Search one conversation (no index build, bounded by the visible thread). */
export function searchThread<M extends SearchableMessage>(
  messages: readonly M[] | undefined | null,
  query: string,
  limit: number = DM_SEARCH_MAX_RESULTS,
): DmSearchHit[] {
  if (!Array.isArray(messages)) return []
  return searchDmIndex(
    messages.map((message) => ({ peerId: '', message })),
    query,
    limit,
  )
}
