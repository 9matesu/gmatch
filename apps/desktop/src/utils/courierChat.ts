import type { ChatMessage } from '../hooks/useP2P'
import type { DmMessage } from './mail-dm'

/**
 * Courier thread → chat row shape.
 *
 * Both the on-open load and the live mirror effect use this, so a message can
 * never render differently depending on how it arrived. Two rules matter:
 *
 * - `readByRecipient` comes from the peer's read watermark (`readTs`), never
 *   from the delivery ack. A delivered-but-unopened message is "Delivered".
 * - `deletedAt`/`reactions` are carried through so a tombstone renders as
 *   "Message deleted" instead of vanishing or reappearing as text.
 */
export function courierThreadToChatMessages(args: {
  thread: readonly DmMessage[] | undefined | null
  peerId: string
  selfId: string
  resolveName: (payloadName: string | undefined, senderId: string) => string
}): ChatMessage[] {
  const { thread, peerId, selfId, resolveName } = args
  if (!Array.isArray(thread)) return []
  return thread.map((m) => {
    const senderId = m.own ? selfId : peerId
    return {
      id: m.id,
      senderId,
      senderName: resolveName(m.own ? undefined : m.senderName, senderId),
      text: m.text,
      timestamp: m.ts,
      readByRecipient: Boolean(m.readTs && m.readTs >= m.ts),
      courierStatus: m.status,
      replyToId: m.replyToId,
      editedAt: m.editedTs ? new Date(m.editedTs).toISOString() : undefined,
      deletedAt: m.deletedTs,
      reactions: m.reactions,
      attachmentId: m.attachmentId,
      attachmentUrl: m.attachmentId ? `/api/objects/${m.attachmentId}` : undefined,
    }
  })
}

/**
 * Cheap equality for the live mirror: identical rows must not replace the
 * array, or every courier state bump (typing sweeps included) re-renders and
 * resets scroll. Covers every field the mapper can change.
 */
export function chatRowEqual(a: ChatMessage, b: ChatMessage): boolean {
  if (
    a.id !== b.id ||
    a.text !== b.text ||
    a.timestamp !== b.timestamp ||
    a.senderId !== b.senderId ||
    a.senderName !== b.senderName ||
    a.readByRecipient !== b.readByRecipient ||
    a.courierStatus !== b.courierStatus ||
    a.deletedAt !== b.deletedAt ||
    a.editedAt !== b.editedAt ||
    a.replyToId !== b.replyToId ||
    a.attachmentId !== b.attachmentId
  ) {
    return false
  }
  const ra = a.reactions
  const rb = b.reactions
  if (!ra || !rb) return !ra && !rb
  const ka = Object.keys(ra)
  if (ka.length !== Object.keys(rb).length) return false
  return ka.every((emoji) => {
    const va = ra[emoji] || []
    const vb = rb[emoji] || []
    return va.length === vb.length && va.every((actor, i) => actor === vb[i])
  })
}
