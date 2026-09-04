import { randomUUID } from 'node:crypto'

export interface SignalOfferEntry {
  id: string
  sender_id: string
  receiver_id: string
  offer: unknown
  answers: unknown[]
  ice: Array<{ is_sender: boolean; candidate: unknown }>
  createdAt: number
}

const OFFER_TTL_MS = 5 * 60 * 1000

const offers = new Map<string, SignalOfferEntry>()

let sweepTimer: ReturnType<typeof setInterval> | null = null

function ensureSweep() {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - OFFER_TTL_MS
    for (const [id, entry] of offers) {
      if (entry.createdAt < cutoff) offers.delete(id)
    }
  }, 60_000)
  try {
    sweepTimer.unref?.()
  } catch {}
}

export function createOffer(senderId: string, receiverId: string, offer: unknown): string {
  const id = randomUUID()
  offers.set(id, {
    id,
    sender_id: senderId,
    receiver_id: receiverId,
    offer,
    answers: [],
    ice: [],
    createdAt: Date.now(),
  })
  ensureSweep()
  return id
}

export function getOffer(id: string): { sender_id: string; receiver_id: string } | null {
  const entry = offers.get(id)
  if (!entry) return null
  return { sender_id: entry.sender_id, receiver_id: entry.receiver_id }
}

export function getOfferPayload(id: string): unknown | null {
  return offers.get(id)?.offer ?? null
}

export function pendingFor(receiverId: string): Array<{ id: string; sender_id: string }> {
  const out: Array<{ id: string; sender_id: string }> = []
  for (const entry of offers.values()) {
    if (entry.receiver_id === receiverId && entry.answers.length === 0) {
      out.push({ id: entry.id, sender_id: entry.sender_id })
    }
  }
  out.sort((a, b) => {
    const ea = offers.get(a.id)!
    const eb = offers.get(b.id)!
    return ea.createdAt - eb.createdAt
  })
  return out
}

export function addAnswer(id: string, answer: unknown): 'created' | 'already_answered' {
  const entry = offers.get(id)
  if (!entry) return 'already_answered'
  if (entry.answers.length > 0) return 'already_answered'
  entry.answers.push(answer)
  return 'created'
}

export function getAnswer(id: string): unknown | null {
  const entry = offers.get(id)
  if (!entry || entry.answers.length === 0) return null
  return entry.answers[entry.answers.length - 1]
}

export function addIce(id: string, candidate: unknown, isSender: boolean): boolean {
  const entry = offers.get(id)
  if (!entry) return false
  entry.ice.push({ is_sender: isSender, candidate })
  return true
}

export function getIce(id: string, wantSender: boolean): unknown[] {
  const entry = offers.get(id)
  if (!entry) return []
  return entry.ice
    .filter((i) => i.is_sender === wantSender)
    .map((i) => i.candidate)
}

/** Test helper: drop all offers and stop the TTL sweeper. */
export function resetSignalStore() {
  offers.clear()
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}