# gmatch rendezvous (free, blind)

A single Cloudflare Worker: the always-on meeting point for gmatch's sealed
mail and public server directory. Deploy with `npx wrangler deploy` from this
directory (or `npx wrangler deploy --config worker/wrangler.toml` from the repo
root). It uses only the free Workers plan and one free Workers KV namespace
(binding `RENDEZVOUS`, id committed in `wrangler.toml`).

## What it holds

- **Only** sealed envelope ciphertext (`Envelope` v2 — the courier already
  validates shape; this Worker does too) and bounded, self-declared server
  metadata (name, description, `endpoint_hint`, counts, tags).
- It never sees message bodies, media bytes, profiles, identity headers or
  signatures. It does not log who talked to whom; tokens are public routing
  labels (`blake3(pubkey)`), and directory rows have `owner_id: ''`.

## Wire (the same one the node's courier speaks)

| Route | What |
|---|---|
| `PUT /api/mail/:token` | `{env}` — validate shape, store verbatim, TTL ≤120s |
| `GET /api/mail/:token` | `{envelopes: [...]}` — unexpired ciphertext only |
| `POST /api/mail/:token/ack` | `{ids}` — drain those ids; `pubkey`/`sig`/`epoch` ignored |
| `DELETE /api/mail/:token` | `{ids?}` — drain ids, or the whole box when omitted |
| `GET /api/servers` | `{servers: [...]}` — rows heartbeated in the last 24h |
| `POST /api/servers` | upsert a self-declared row; TTL 24h |
| `OPTIONS *` | CORS preflight (`*`, all four verbs) |

All responses carry CORS headers. Tokens are 32–64 hex; envelope ids are
8–64 `[A-Za-z0-9_-]`; `sealed` is ≤64 KiB; directory fields are length- and
shape-bounded. Bad shapes get 400; unknown routes get 404.

## Honest boundaries

- **No WebSocket.** A Durable Object with hibernation would add a migration,
  state and cost for latency only. `MailClient` already falls back to polling
  each mailbox every 20s when a socket cannot open, so `/api/mail/ws` answers
  501 explicitly and the HTTP path is the guaranteed one. KV is eventually
  consistent: mail is best-effort delivery in a ~2-minute window, and a fresh
  directory row can take up to ~60 s to appear on another edge. Neither is a
  durable log, a read receipt, or an authority.
- **Reachability, not NAT traversal.** A hosted mailbox and directory let two
  peers find each other and exchange sealed mail even when no peer's node is
  reachable. It does **not** turn a symmetric-NAT pair into a direct WebRTC
  channel: the public TURN candidate and the node's `SWARM_FRAME` relay remain
  the transport fallback.
- **A blind bulletin board, not an authority.** Directory coordinates and
  names are self-declared. This Worker cannot verify signatures (it has no
  identity model) so it ignores them, and `endpoint_hint` is returned to
  everyone — that is the price of discovery without an account system.
- **No world data.** No profiles, posts, likes, media or server content is
  deployed here. Every install still runs its own local node.

To point a desktop build at a different rendezvous, set `VITE_CENTRAL_URL` or
`gmatch.central.url` in Settings → Servers; `none`/`off`/`0` opts out entirely.
