import { resolveDisplayName, type NameRosterEntry } from '../../utils/displayName'

/**
 * The chat hub's participant-name resolver.
 *
 * The lobby and the card queue are not people — they are the two public
 * channels the hub opens by default — so they keep fixed labels. Everything
 * else is a real account and goes through the shared resolver.
 *
 * This used to be an inline chain in GMatchDMs that:
 *   - returned the literal 'User' whenever the peer was missing from the
 *     (capped) `users` prop, which is most of them for a room or a DM;
 *   - REJECTED any name starting with '0x' or longer than 32 chars, silently
 *     downgrading a real name to 'User'.
 * Both are gone. The important change in behaviour: a name that travelled
 * with the message (sealed DMs and rooms now carry one) is preferred over the
 * roster, so a renamed user is not relabelled retroactively.
 */
export function chatDisplayName(opts: {
  /** Participant id: an orbit id, or one of the two channel sentinels. */
  id: string
  /** Name carried on the message being rendered. */
  payloadName?: string | null
  /** The hub's peer roster (capped — absence is normal, not exceptional). */
  roster?: ReadonlyMap<string, NameRosterEntry> | null
  selfId?: string | null
  selfName?: string | null
}): string {
  const { id } = opts
  if (id === 'global_lobby') return 'Lobby Lounge (Everyone)'
  if (id === 'card_queue') return 'Card Game Queue'
  return resolveDisplayName({
    selfId: opts.selfId,
    senderId: id,
    payloadName: opts.payloadName,
    roster: opts.roster,
    // The viewer's own name is the last resort, never a channel label.
    fallback: opts.selfName,
  })
}
