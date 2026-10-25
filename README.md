# gmatch

Private, peer-to-peer social software for Windows. A social feed, encrypted
conversations, shared media and a small arcade — built local-first, with the
transport kept blind and the media sealed end to end.

Single portable `.exe`, no installer, no sign-up, no telemetry, no ads.

## Properties the code actually enforces

- **Local-first data.** No account is created anywhere. Identity is an
  Ed25519 + X25519 keypair generated on the machine; profile fields, posts and
  reactions are signed operations replayed from a durable local log.
- **End-to-end encrypted media.** Swarm transfers use a per-transfer ephemeral
  X25519 offer, a DEK sealed to that offer, and XChaCha20-Poly1305 chunks with
  AAD binding object, transfer, index and requester. A relay — including the
  node's own WebSocket fallback — carries ciphertext it cannot read or alter.
  Legacy plaintext transfer is disabled by default.
- **A blind relay.** The hosted surface forwards sealed envelopes addressed to
  rotating tokens. It stores no content tables, keeps no presence directory,
  and never sees a message body.
- **Explicit transport selection.** Direct WebRTC is attempted under a bounded
  deadline; the relay stays available meanwhile; a peer is labelled direct
  only after the DataChannel opens. The UI reports the real path.
- **Verifiable downloads.** Release hashes are derived mechanically from the
  shipped file (`site/release.json` + `site/check.mjs`, the release honesty
  gate that fails the build on any mismatch).

Safety is enforced in the client, not on a server: a first-launch gate, a
client-side prohibited-tag blocklist (`shared/blocklist.json`, guarded against
drift by a parity test), and report-driven moderation where a moderator sees a
conversation only after the person involved discloses that one item.

## Find players

A packaged install starts **its own node**, so the first world is the machine
you are on. To meet other people, share your node code or join a node a friend
runs (`+ Add server` → *Join with code*). The Servers list also shows the nodes
published in the public directory; the Cloudflare rendezvous at
`gmatch.pages.dev` carries that metadata and sealed mail only, never content,
and can be switched off with `gmatch.central.url = none`.

Check what the rendezvous answers (it must 404 every stateful route):

```bash
curl -s https://gmatch.pages.dev/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://gmatch.pages.dev/api/posts
```

## Repository layout

```
apps/desktop/        Electron main + preload (electron/*.cjs) and React renderer (src/)
apps/api/            Hono + SQLite node on Bun (packaged as a local sidecar)
packages/crypto      Keys, ECIES, AEAD, hashing
packages/protocol    Signed operations, swarm-v1 chunk crypto, replication receipts
packages/shared      Shared types and tag/taxonomy helpers
shared/              blocklist.json and sources.json (single source of truth)
docs/                Architecture, protocol, security audits, roadmap
site/                Cloudflare Pages release page (static, no JavaScript)
```

## Build and verify

Requires Node 22+ and npm. The API workspace runs on Bun.

```bash
npm install
npm run lint          # 0 errors required
npm run typecheck
npm run test          # all workspaces
npm run build         # renderer production build
npm run electron      # desktop app
```

Release artifacts:

```bash
cd apps/desktop && npm run dist          # portable exe in apps/desktop/release/
cd site && node build-release.mjs <exe>  # copies + writes release.json from the file
node site/check.mjs                      # release honesty gate
```

### Executed P2P evidence

`apps/desktop/scripts/p2p-two-process.mjs` runs the production swarm engine in
two real OS processes with an untrusted relay between them and asserts: a clean
transfer arrives byte-identical, a one-byte tamper of one sealed chunk fails
the transfer at the AEAD check, and no plaintext media slice appears in any
relayed frame. Run it with `node scripts/p2p-two-process.mjs` from
`apps/desktop`. Cross-NAT validation is a runbook, not a claim:
`apps/desktop/nat-lab/README.md`.

## Documentation

- `docs/SPEC.md` — product and system specification
- `docs/ARCHITECTURE-P2P.md` — presence, signaling, transport selection, swarm-v1, operation semantics
- `docs/SECURITY.md` — threat model and security invariants
- `docs/SECURITY-AUDIT.md` — white-box audit report (site copy: `site/legal/security.html`)
- `docs/LOCAL-FIRST-ROADMAP.md` — what is done and what is explicitly open
- `docs/DESKTOP.md` — desktop runtime internals

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).
Do not open a public issue for an unfixed vulnerability.

## License

No license is granted. The source is published so that the shipped binary can
be audited against it; all rights are reserved.
