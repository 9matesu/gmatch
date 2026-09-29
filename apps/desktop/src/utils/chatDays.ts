import type { ChatMessage } from '../hooks/useP2P'

/**
 * Day separators for a chat stream.
 *
 * The problem: a conversation that has been running for three days renders as
 * one undifferentiated wall of text. The per-message clock (HH:MM) actively
 * hides the age, because 14:32 is equally true of last Tuesday — so a reply
 * from three days ago looks like it was sent during this session.
 *
 * This is the one place that knows about calendar days. It is a pure function
 * over the message array so it can be unit-tested without a DOM, matching the
 * convention already set by utils/timeAgo.ts (injectable `now`, pure).
 */

export { type ChatMessage }

/** Consecutive same-author messages inside this window stay in one block. */
const GROUP_WINDOW_MS = 5 * 60 * 1000

/**
 * Local calendar day as `YYYY-MM-DD`.
 *
 * Deliberately LOCAL, not UTC. "Today" has to mean today where the reader is;
 * keying off UTC put a 23:30 message on the wrong day's separator for half the
 * planet, which is exactly the confusion separators are meant to remove.
 */
export function dayKey(timestamp: number): string {
  const d = new Date(timestamp)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Midnight, local, at the start of the day `timestamp` falls in. */
function startOfDay(timestamp: number): number {
  const d = new Date(timestamp)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * The label for a day separator: "Today", "Yesterday", "N days ago", then a
 * real date once counting stops being useful.
 *
 * The request was specifically to say how long ago a message is, so the
 * relative form is kept as long as it is meaningful rather than jumping
 * straight to a date the reader has to compare against a calendar.
 */
export function daySeparatorLabel(timestamp: number, now: number = Date.now()): string {
  // Whole calendar days between the two midnights — not 24h windows, which
  // would call a 23:59 message "tomorrow's".
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / 86_400_000)
  if (days <= 0) return 'Today' // also covers clock skew from other clients
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export type ChatRow =
  | { kind: 'day'; key: string; label: string; timestamp: number }
  | { kind: 'message'; key: string; messages: ChatMessage[] }

/**
 * Turn a flat, chronological message list into a render list of day
 * separators and message blocks.
 *
 * Block grouping is unchanged from what the hub already did (same author,
 * within 5 minutes) — this only inserts a separator whenever the calendar day
 * changes, so a single pass produces both concerns and the two cannot disagree
 * about where a conversation "starts".
 */
export function groupMessagesByDay(messages: readonly ChatMessage[], now: number = Date.now()): ChatRow[] {
  const rows: ChatRow[] = []
  let currentDay: string | null = null
  let currentBlock: ChatMessage[] | null = null

  const closeBlock = () => {
    if (currentBlock && currentBlock.length > 0) {
      rows.push({
        kind: 'message',
        key: `b:${currentBlock[0].id}`,
        messages: currentBlock,
      })
    }
    currentBlock = null
  }

  for (const msg of messages) {
    const key = dayKey(msg.timestamp)
    if (key !== currentDay) {
      closeBlock()
      currentDay = key
      rows.push({ kind: 'day', key: `d:${key}`, label: daySeparatorLabel(msg.timestamp, now), timestamp: msg.timestamp })
    }
    const prev = currentBlock ? currentBlock[currentBlock.length - 1] : null
    if (prev && prev.senderId === msg.senderId && msg.timestamp - prev.timestamp < GROUP_WINDOW_MS) {
      currentBlock!.push(msg)
    } else {
      closeBlock()
      currentBlock = [msg]
    }
  }
  closeBlock()
  return rows
}
