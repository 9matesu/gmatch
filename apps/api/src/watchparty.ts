// Watch Party in-memory state + WS frame handling. Parties are ephemeral by
// design (a cold node drops them; clients see 404 and say so honestly), so
// there is deliberately no migration here.
import { randomUUID } from 'node:crypto'

export interface PartyFrame {
  url: string
  action: 'play' | 'pause'
  position: number
  rate: number
  updatedAt: number
}

export interface Party {
  id: string
  name: string
  mediaUrl: string
  frame: PartyFrame
  members: Map<string, string> // userId -> display name
  lastSeen: number
}

const parties = new Map<string, Party>()
const MAX_PARTIES = 50
const IDLE_MS = 30 * 60_000
// media URL -> owning party id. Lets the objects route authorize reads for
// private party media without making it feed-public.
const partyMedia = new Map<string, string>()

export function createParty(name: string, mediaUrl: string, seedUrl: string): Party {
  gcTick()
  const party: Party = {
    id: randomUUID().slice(0, 8),
    name: name.slice(0, 40) || 'Party',
    mediaUrl,
    frame: { url: seedUrl, action: 'pause', position: 0, rate: 1, updatedAt: serverNow() },
    members: new Map(),
    lastSeen: Date.now(),
  }
  parties.set(party.id, party)
  partyMedia.set(mediaUrl, party.id)
  return party
}

/** Media URL capability check for the objects route: party videos stay
 * private (never feed-public) but any holder of the URL may stream them.
 * The UUID path is the capability; party URLs only travel inside the room. */
export function isPartyMediaObject(mediaUrl: string): boolean {
  return partyMedia.has(mediaUrl)
}

export function getParty(id: string): Party | null {
  return parties.get(id) || null
}

export function partyRoom(id: string): string {
  return `watch:${id}`
}

function serverNow(): number {
  return Date.now() / 1000
}

function gcTick(): void {
  const now = Date.now()
  for (const [id, p] of parties) {
    if (now - p.lastSeen > IDLE_MS) {
      parties.delete(id)
      partyMedia.delete(p.mediaUrl)
    }
  }
  while (parties.size >= MAX_PARTIES) {
    const oldest = parties.keys().next().value as string
    const p = parties.get(oldest)
    if (p) partyMedia.delete(p.mediaUrl)
    parties.delete(oldest)
  }
}

/** Validate + apply one client control frame. Returns null to drop it. */
export function applyWatch(userId: string, msg: any): { room: string; payload: any } | null {
  if (!msg || typeof msg !== 'object') return null
  const party = parties.get(String(msg.party || ''))
  if (!party || !party.members.has(userId)) return null
  if (msg.action !== 'play' && msg.action !== 'pause') return null
  const position = Number(msg.position)
  if (!Number.isFinite(position) || position < 0) return null
  // V1 lock: party speed is always 1x. A rate != 1 frame is a desync bug or
  // a modified client; drop it.
  if (msg.rate !== undefined && Number(msg.rate) !== 1) return null
  party.lastSeen = Date.now()
  party.frame = {
    url: party.mediaUrl,
    action: msg.action,
    position,
    rate: 1,
    updatedAt: serverNow(),
  }
  return { room: partyRoom(party.id), payload: { type: 'watch.sync', party: party.id, frame: party.frame } }
}

/** Handle watch.join: add member, return the snapshot payload for the room. */
export function joinWatch(userId: string, displayName: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party) return null
  if (party.members.size >= 8 && !party.members.has(userId)) return null
  party.members.set(userId, String(displayName || '').slice(0, 40))
  party.lastSeen = Date.now()
  return {
    room: partyRoom(party.id),
    payload: {
      type: 'watch.roster',
      party: party.id,
      members: [...party.members.entries()].map(([id, name]) => ({ id, name })),
    },
  }
}

export function watchPong(t0: unknown): { type: string; t0: number; t1: number } {
  return { type: 'watch.pong', t0: Number(t0) || 0, t1: serverNow() }
}

/** Test seam: wipe state between suites. */
export function __resetParties(): void {
  parties.clear()
  partyMedia.clear()
}
