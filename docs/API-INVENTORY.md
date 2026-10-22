# API inventory — what each central route is for

Every node route the desktop client calls, and what it is allowed to be.
This is the L7 requirement ("inventory and explicitly migrate or retain every
remaining central service rather than silently treating rendezvous as content
authority"). A new route that is not listed here fails the guard test
(`apps/desktop/src/utils/apiInventory.test.ts`), so the inventory cannot rot.

The central deployment is a **blind courier** (`SITE_SERVICES=mail,turn`): it
serves mail, TURN and a few static public endpoints, and answers **404** for
every stateful route below. A node that hosts a world answers all of them.
The client must therefore treat "route missing" as a state, not a crash.

Roles:

| role | meaning |
|---|---|
| `rendezvous` | presence, discovery, signaling, tickets. No user content; being central is a property, not a debt. |
| `economy` | the authoritative `g$` ledger. Deliberately node-authoritative: settlement needs one ordering. |
| `core-social` | stateful social content. **The L4/L5 migration target** — these are the routes that make the app "not really decentralized". |
| `media-metadata` | object registration and story lists. L6 target. |
| `legacy` | retired routes. The client must never call them; the courier 404s them. |
| `optional` | enhancements that may be absent. Offline state is honest and quiet. |
| `host` | only meaningful when THIS machine hosts a node. |

## Inventory

Patterns: a trailing `*` covers every route below it.

| Route | Role | Notes |
|---|---|---|
| `/api/health` | rendezvous | public; reports courier vs node mode |
| `/api/discord-invite` | optional | public static invite link |
| `/api/identity` | rendezvous | node X25519 public key (sealing capability) |
| `/api/ws-ticket` | rendezvous | socket authentication ticket |
| `/api/users/online` | legacy | 404 on the courier; presence comes from sealed beacons |
| `/api/users/heartbeat` | rendezvous | server listing heartbeat (host mode) |
| `/api/signal/*` | legacy | retired: signaling rides sealed mail |
| `/api/gossip/*` | rendezvous | signed public gossip envelopes (metadata only) |
| `/api/users` | core-social | directory (profiles/labels); L5 target |
| `/api/users/*` | core-social | profile, follow, block, report, hacks, store; L5 target |
| `/api/posts` | core-social | **the feed read/write path**; L4 target |
| `/api/posts/*` | core-social | likes, saves, comments, reports, archive; L5 target |
| `/api/likes/*` | core-social | like rows; L5 target |
| `/api/inbox` | core-social | inbox threads; L5 target |
| `/api/inbox/*` | core-social | inbox actions (favorite, remove) |
| `/api/notifications` | core-social | server notification rows; L5 target |
| `/api/notifications/*` | core-social | notification reads |
| `/api/relationships` | core-social | follows/blocks; L5 target |
| `/api/report` | core-social | generic report (node-hosted content) |
| `/release.json`, `/releases/*` | host | the release feed this node offers its peers (the updater reads it) |
| `/api/auth/*` | core-social | passkey enrolment; L5 target |
| `/api/objects` | media-metadata | object bytes/metadata; L6 target |
| `/api/objects/*` | media-metadata | register, stories, archive, view; L6 target |
| `/api/recommendations` | optional | suggested peers |
| `/api/announcements` | optional | banner announcements |
| `/api/flash` | optional | ephemeral flash messages |
| `/api/slideshows` | optional | slideshow content |
| `/api/slideshows/*` | optional | slideshow items |
| `/api/groups` | optional | group listings |
| `/api/groups/*` | optional | group members, messages, leave |
| `/api/watchparty` | optional | watch-party room listing |
| `/api/watchparty/*` | optional | watch-party rooms (join, invite, video) |
| `/api/lobby` | optional | lobby listing |
| `/api/lobby/*` | optional | lobby chat, matches, images, comments, invites |
| `/api/babecock/*` | optional | the idle-game's online layer (rounds, invites) |
| `/api/babecock/current` | optional | current idle round |
| `/api/babecock/gallery` | optional | online gallery view |
| `/api/babecock/invites` | optional | idle-game invites |
| `/api/cards` | economy | card collection |
| `/api/cards/*` | economy | buy, cashout, transfer, moderation |
| `/api/cards/market` | economy | card market |
| `/api/decks` | economy | deck building |
| `/api/decks/*` | economy | deck cards, validate |
| `/api/domination/*` | economy | prices, trigger, settings, targets, history, ack |
| `/api/economy/*` | economy | cashout rate |
| `/api/servers` | host | the directory of the node you are on (per node now) |
| `/api/servers/*` | host | host-mode dashboard, node registration |
| `/api/server/*` | host | host-mode password |
| `/api/snapshot` | host | world snapshot export/import (admin) |
| `/api/snapshot/*` | host | snapshot import |
| `/api/admin/*` | host | the moderation/admin suite (PIN) |
| `/api/pm` | legacy | retired: DMs ride sealed mail envelopes |
| `/api/pm/*` | legacy | retired |

## What this means

- **No hidden central fallback.** A `core-social` route that is missing must
  show an honest state (absent / unavailable / queued), never a fabricated
  row. The peer-replicated paths (operation log → feed projection) already
  cover posts, likes and comments for content that exists locally.
- **The economy stays central on purpose.** `g$` settlement needs one
  ordering; two peers cannot both be authoritative for a duel.
- **Courier 404s are a state.** `detectMailMode` and the invite probe treat a
  404 as "this node hosts no stateful route", not as an error to retry.

## Guard

`apps/desktop/src/utils/apiInventory.test.ts` scans the renderer for every
`orbitFetch('/api/...')` route and fails if one is missing from this file.
Adding a route means adding a row here — with its role and its migration
target — in the same commit.
