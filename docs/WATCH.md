# Watch Rooms (gMatch Watch section)

Synced watch parties without video/voice/screen WebRTC. Each member plays
the video locally in their own browser; the room shares only the player
STATE (url, position, playing, host, queue) as tiny JSON frames relayed by
the server clock. That is the whole trick: no media ever crosses the WS,
and playback stays frame-accurate within the drift deadband.

```text
                 ROOM (server, in-memory)
                   │
          ┌────────┴────────┐
          │                 │
      Shared State        Chat
      frame {url,action,  server-held log
      position,by,        (80 msgs, joiner
      updatedAt}          gets backlog)
          │
     ┌────┼─────────┐
     ▼    ▼         ▼
   User A User B  User C     each: <video src=same url>
  local player local local    + 250ms drift tick
```

## Code map

| Area | File |
|---|---|
| Room state + frame handlers | `apps/api/src/watchparty.ts` |
| WS dispatch | `apps/api/src/ws-bus.ts` (`watch.*` branches) |
| Close-hook presence | `apps/api/src/routes/ws.ts` (`watchDisconnect`) |
| REST + media pipeline + relay stream | `apps/api/src/routes/watchparty.ts` |
| URL parsing (all sites) | `apps/api/src/proxy.ts` (`classifyAndResolve` chain) |
| Sync math (pure) | `apps/desktop/src/utils/watchSync.ts` |
| Client store + frames | `apps/desktop/src/hooks/watchPartyStore.ts` |
| Shared WS socket | `apps/desktop/src/utils/orbitWebSocket.ts` |
| Theater UI | `apps/desktop/src/components/watchparty/` |

## Room lifecycle

1. `POST /api/watchparty` {url,name} resolves the media (below) and creates
   the room. The creator is HOST and auto-joins. Rooms live in memory but
   are flushed to `WATCH_PARTIES_PATH` (default: beside the DB snapshot on
   /data) every 30 s and on SIGTERM, and restored at boot: a deploy no
   longer kills live rooms. A room still dies on 4 h idle; clients then get
   one `watch.gone` frame ("has closed"), never a 404 loop. Socket close
   removes a member only after an 8 s grace, so a reconnect blip keeps the
   seat (and a last-member blip keeps the room).
2. Others join from the room list, the invite link `#/watch?room=<id>`, or
   the 8-hex code. `watch.join` subscribes the socket to room `watch:<id>`
   and the room receives a roster + "X joined" system line; the joiner
   receives ONE snapshot roster frame carrying `{host, members, frame, chat,
   queue, current}` (position + backlog recovery for free).
3. Leave: explicit `watch.leave`, or the last socket of a user closing
   (`watchDisconnect` promotes the host to the oldest remaining member).
   Empty room = deleted.
4. Kicked/banned targets get a direct `watch.kicked`, lose room membership,
   and (ban) cannot rejoin for the room's lifetime.

## Frame protocol (client -> server unless noted; server drops invalid ones)

| Frame | Payload | Server rule |
|---|---|---|
| `watch` | `{party, action: play\|pause, position}` | members only; position finite >=0; rate locked 1; re-stamped `updatedAt` = server clock + `by` = member name; relayed as `watch.sync` |
| `watch.join` | `{party, name}` | member (not banned, cap 8); relays `watch.roster` (with snapshot) + `watch.system` |
| `watch.leave` | `{party}` | member; relays `watch.system` + `watch.roster` |
| `watch.chat` | `{party, text}` | member, not muted; 80 chars; 1 msg/2s per user; stored + relayed as `watch.chat` with `msgId` |
| `watch.chat.del` | `{party, msgId}` | author or host; relays `watch.chat_del` |
| `watch.kick` / `watch.ban` | `{party, target}` | host only, target != host; relay system + roster; direct `watch.kicked` |
| `watch.mute` | `{party, target, on}` | host only; relays `watch.settings.muted` |
| `watch.host` | `{party, target}` | host only, target is member; relays `watch.roster` |
| `watch.settings` | `{party, name?, isPrivate?, lockVideo?}` | host only; clamped; relays `watch.settings` |
| `watch.queue` | `{party, op: add\|remove\|play\|next, id?, url?, name?, relay?}` | member; `add`/`play` need `lockVideo` off unless host; relays `watch.queue` `{queue, current, frame}` |
| `watch.ping` | `{t0}` | anyone authed; direct `watch.pong {t0, t1}` (never broadcast) |
| room -> all | `watch.sync`, `watch.roster`, `watch.system`, `watch.chat`, `watch.chat_del`, `watch.settings`, `watch.queue` | |

## Media pipeline (`resolveMedia`, one code path for create + video + queue)

1. `proxyAndStoreExternal` pulls the bytes ONCE into encrypted storage and
   the room streams them from `/api/objects/<id>` (private: `is_public=0`,
   readable because `isPartyMediaObject()` authorizes the party-capability
   URL inside the objects route).
2. If the file is above the 50MB store cap, `classifyAndResolve` extracts
   the direct .mp4 and the room binds a RELAY: `GET /api/watchparty/:id/stream`
   is a Range passthrough to that one upstream with the page referer
   (probe: video/* content-type, <=500MB). The room id is the capability;
   this is not an open proxy.
3. Reconnect: after a WS reconnect the server-side socket holds no rooms;
   `auth_ack` fans `__ws_reconnected` and the store re-sends `watch.join`
   for every open party. The join snapshot restores frame/chat/queue.

## Parsing new sites (modular)

`classifyAndResolve` runs per-site resolvers then `resolveOpenGraph`, whose
site-agnostic core is `extractEmbeddedMp4(html)`: unescapes `\u002F`, finds a
direct `.mp4`, prefers it over `og:image` and skips `.m3u8`. Any page that
embeds its file URL parses with zero new code (pmvhaven verified live:
201 relay room + 206 stream with `ftyp`). A site that needs an API or
signature gets ONE new resolver function in the chain, plus a fixture in
`apps/api/src/proxy.test.ts` (see the pmvhaven case).

## Sync math (`watchSync.ts`, all unit-tested)

- Server clock estimate: `watch.pong` samples, lowest-RTT wins; burst of 3
  every 2s after joining, then one per 30s, only while a room is open.
- Target position = `position + (serverNow - updatedAt)` while playing.
- `driftCorrection`: paused/local-behind-seek on |drift| > 0.3s deadband,
  playing-ahead or >2s lag seeks, otherwise playback rides its own clock.
- Queue advance keeps the room PLAYING (autoplay continues overnight). An
  ended video re-stamps the frame, so `next` wraps past the last entry and a
  single-entry playlist loops it. The client guard keys on
  `current:frame.updatedAt` so a wrap re-arms it.
- Overnight survival: room GC is 4 h and every open tab's 30 s `watch.ping`
  refreshes the life of all rooms that user is in. Queue cap 50; the video
  route accepts `urls[]` (max 10/request, returns `{added, failed}`), which
  the queue rail and the create modal feed with one multi-line paste.
  No rate control (party is 1x).
- Stream hiccup (relay 502, upstream abort): the slot's `error`/`stalled`
  listeners reload the element (max once per 5 s) and the sync tick re-joins
  the party position. Players use `preload="auto"`; the relay answers with
  `private, max-age=60` so seek-back reads hit the browser cache.

## Trust boundaries

- Single fly machine owns the room map; the JSON flush is that machine's
  volume. Two machines would each restore their own copy -> rooms need a
  Durable Object before scaling out.
- Every gate is server-side: membership, host-only ops, bans, mute, rate
  limits, clamps (name 40, queue 50, chat 80 msgs / 80 chars, members 8,
  bulk add 10/request).
- The stream endpoint is unauthenticated BY DESIGN (raw `<video>` cannot
  sign): the unguessable room id + server-bound upstream are the controls.
- Modified clients cannot desync others: frames re-stamp at the server,
  `rate != 1` is dropped, non-members are dropped.

## Explicit non-goals

Voice/video/screen sharing, per-user playback speed, persistent rooms or
ban history (migration + cleanup wiring if ever), host-only transport,
emoji picker, DMs from the room (use Chat), HLS playback.

## Verifying

- API: `cd apps/api && npx vitest run` (watchparty*, ws-bus, proxy).
- Desktop: `cd apps/desktop && npx vitest run` (watchPartyStore, watchSync,
  watchparty components) + `bash design-gates.sh`.
- Manual: two windows (two identities or one identity, two tabs each holds
  its own socket), open Watch, START A PARTY, paste a pmvhaven page URL,
  play/pause/seek from the other window, kick + rejoin, reload for snapshot
  recovery.
