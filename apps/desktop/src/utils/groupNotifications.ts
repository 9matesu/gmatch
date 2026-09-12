/**
 * Instagram-style activity grouping (client-side fold over /api/notifications
 * — the server list is already capped at 50, no memo needed).
 */
export interface NotifItem {
  id: string
  type: string
  title: string
  body: string | null
  /** Server sends JSON strings; be tolerant of both shapes. */
  data: unknown
  read: number
  created_at: string
}

export interface NotifGroup {
  key: string
  type: string
  actors: string[]
  items: NotifItem[]
  unread: number
  latest: string
}

/** Types that fold; everything else (pm, system, invites) renders per-row. */
const GROUPABLE = new Set(['like', 'comment', 'follow', 'card_purchase', 'card_received'])

const DAY = 24 * 60 * 60 * 1000

function dataOf(n: NotifItem): Record<string, unknown> {
  if (typeof n.data === 'string') {
    try { return JSON.parse(n.data) as Record<string, unknown> } catch { return {} }
  }
  return (n.data as Record<string, unknown>) ?? {}
}

/** Actor name is the leading token of the server title: "Rafael liked ...". */
function actorOf(n: NotifItem): string {
  const d = dataOf(n)
  return String(d.actor ?? d.buyer_id ?? d.sender_id ?? d.follower_id ?? n.title.split(' ')[0] ?? 'Someone')
}

function subjectOf(n: NotifItem): string {
  const d = dataOf(n)
  return String(d.card_id ?? d.post_id ?? d.object_id ?? '')
}

export function groupNotifications(rows: NotifItem[]): NotifGroup[] {
  const groups: NotifGroup[] = []
  const byKey = new Map<string, NotifGroup>()
  for (const n of rows) {
    const subject = subjectOf(n)
    // Follows carry no shared subject — fold them all into one "started
    // following you" group (Instagram behavior); the rest fold per subject.
    const key = GROUPABLE.has(n.type) ? `${n.type}|${subject}` : `solo|${n.id}`
    let g = byKey.get(key)
    if (g && new Date(g.latest).getTime() - new Date(n.created_at).getTime() > DAY) {
      g = undefined // a day apart is a different wave of activity
    }
    if (!g) {
      g = { key, type: n.type, actors: [], items: [], unread: 0, latest: n.created_at }
      byKey.set(key, g)
      groups.push(g)
    }
    g.items.push(n)
    g.unread += n.read ? 0 : 1
    const actor = actorOf(n)
    if (!g.actors.includes(actor)) g.actors.push(actor)
  }
  // Server list is newest-first already, but the fold can interleave — re-sort.
  return groups.sort((a, b) => new Date(b.latest).getTime() - new Date(a.latest).getTime())
}

const SENTENCES: Record<string, string> = {
  like: 'liked your card',
  comment: 'commented on your card',
  follow: 'started following you',
  card_purchase: 'bought your card',
  card_received: 'sent you a card',
}

/** "Rafael liked your card" / "Rafael and 3 others liked your card". */
export function groupTitle(type: string, actors: string[]): string {
  const s = SENTENCES[type] ?? 'acted on your card'
  if (actors.length <= 1) return `${actors[0] ?? 'Someone'} ${s}`
  const others = actors.length - 1
  return `${actors[0]} and ${others} ${others === 1 ? 'other' : 'others'} ${s}`
}
