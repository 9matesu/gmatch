# gMatch engagement loop (documented mechanisms)

Status/follower economy exists server-side already: Users.score (season),
Users.score_total (lifetime), Users.likes_received, Users.followers_count,
ranks tab, match payouts (matchEconomy, card-valuation). This doc records what
drives engagement and where it is wired, so no one rebuilds or invents parallel
systems.

## Loops (wired)

| Loop | Signal | Where |
|---|---|---|
| Cold start | empty timeline -> upload nudge + 3 follow suggestions | GMatchFeed empty state, suggestFollows() |
| Feed default | For You (local affinity re-rank) opens first, choice persisted | App feedSort, feedSort.ts |
| Content reward | like/comment/follow notifications (server -> grouped bell) | apps/api/src/notifications.ts |
| First like | session-local flash + sfx on my post 0->1 likes | GMatchFeed first-like chip |
| Status display | follower counts on profile, ranks leaderboard | GMatchProfile, ranks tab |
| Money->status | g$ from likes/idle buys cards, cards win duels | card-valuation, lobby.ts |

## Rules

- New engagement surfaces must use existing metrics; a new counter needs a
  server column + a reason the client can't derive it.
- No fake badges, no phantom counts, no shame copy. Nudges are one-time and
  disappear on first success.
- The user's tab choice is sticky: never force For You on someone who pinned
  Latest.
- All copy follows the humanizer sweep rules (flat, specific, EN).
