# gMatch Admin Suite — privacy-basis ledger (refactor 2026-09-10)

The admin suite (88 endpoints in `apps/api/src/routes/admin.ts`, 65 in the
client choke-point `apps/desktop/src/utils/adminApi.ts`, 9 tabs under
`apps/desktop/src/admin/`) is reviewed module by module against OUR OWN
published privacy policy:

- official site = blind courier, never sees content/identities/presence;
- moderation is **by denunciation**: a report + optional evidence disclosure
  gives the moderator exactly the reported item — never a bulk view;
- this landing is zero-analytics; the app may not ship referrer tracking.

Server-side gate facts: `/verify-pin` 503s without ADMIN_PIN(_HASH) (fly has
none ⇒ suite dark on the official site by configuration); with `ADMIN_ORBIT_ID`
set, the PIN unlocks ONLY for that identity (wave 2 E1) and the grant expires
after 12h (E3 — re-enter the passcode to continue); without it, the node keeps
the host-is-admin model (self-host/LAN, SECURITY-AUDIT F5); with
`SITE_SERVICES=mail,turn` every `/api/admin/*` 404s at the edge — optional
one-command hardening: `fly secrets set SITE_SERVICES=mail,turn -a gmatch`.

| module | endpoints | privacy basis | verdict |
|---|---|---|---|
| PIN gate | POST /verify-pin | n/a | keep |
| Dashboard | GET /dashboard, /live | aggregate counts only | keep |
| Reports (denunciation) | GET /content-reports, POST /content-reports/:id/resolve | IS the legit model | keep + become "Cases" |
| Case view | GET /cases/:reportId (new) | report-scoped target+evidence | ADD |
| Public content mod | GET/PATCH/DELETE /posts, /objects, /lobby-images, /lobby-comments | public surfaces | keep |
| Games ops | /matches*, /special-matches*, /rooms, /babecock, /lobby-images | game integrity | keep |
| Economy integrity | /economy/wallets, /economy/ledger, /decks, /marketplace, /cards | in-game currency fraud triage (no financial data) | keep; label "game economy" |
| Users | /users, ban/unban/moderator/adjust/tags/delete, /users/:id/objects | account admin | keep |
| Platform | /announcements*, /recommendations* | ops config | keep |
| Settings | economy config, lootboxes, bot-config, bots | ops config | keep |
| Audit | GET /audit-log, GET /daily-stats | admin self-accountability + aggregate activity | keep |
| **Bulk DM reader** | GET /private-messages (no-filter decrypts 500), pm hide/delete, phantom pm/:id/unhide (no server route — 404 bug) | **violates denunciation model** | **DELETE** |
| **Cross-DM chat sweep** | GET /chat/messages dm+all sections | bulk private surveillance | **DELETE DM section** (lobby/match/group stay) |
| **Referrer analytics** | GET /traffic-sources + POST /api/stats/referrer + client ReferrerTracker | contradicts zero-tracking claims | **DELETE** |
| Dead tail | POST /cards/backfill, GET /decks/:id, GET /chat (legacy 100-row) | nothing calls them | **DELETE** |
| Store prices | GET/PUT /settings/store-prices | server reader is LIVE (users.ts prices /users/store/items from store_prices) but no admin UI calls the route — keep route, drop dead client method; UI wiring = follow-up | keep route |
| Discord config | GET/PUT /settings/discord-invite | live feature (feed ads + right dock) | keep |

Follow-up candidates (logged, not in scope): GroupMessages stored plaintext
while PMs use `enc:v1` at-rest (rooms are semi-public in-game surfaces; the
E2EE doc tension should be resolved in the courier, not by admin reading);
optional SITE_SERVICES hardening on fly.

Removed capabilities are recoverable from git history; their removal is a
product decision: the software must not be ABLE to bulk-read private
messages, so that no host configuration or admin mistake can do it.

## Wave 2 follow-through (2026-09-12)

The ledger's DELETE verdicts were executed, plus three doors the audit found
still open:

- `GET /api/objects/:id` admin bypass (`isAdminUser`) REMOVED from
  `apps/api/src/routes/objects.ts` — an admin reading a stranger's private
  object now 404s like any stranger. The only admin door to a private object
  is `GET /api/admin/cases/:id/evidence`: a 300s signed token for the ONE
  object the reporter disclosed on THAT case, audited as
  `view_case_evidence`.
- `GET /api/admin/users/:id/objects` (bulk per-user asset sweep) REMOVED;
  client action + modal gone from UsersTab.
- `GET /api/admin/objects` now filters `o.is_public = 1`;
  `/objects/:id/delete|redact` scoped to public objects.
- `DELETE /api/admin/chat/messages/dm/:id` branch REMOVED (unknown channel
  now 400s); `GET /api/admin/cases/:id` no longer points at a phantom
  `/content` route.
- Spy hack (`GET /api/users/hacks/spy-feed/:id`) no longer peeks DM bodies —
  a paid game item never had a right the admin suite lacks.
- Gates: `scripts/security-greps.sh` + `adminEndpointParity.test.ts` fail if
  any of these resurface.
