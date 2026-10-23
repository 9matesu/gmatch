# NAT lab — reproducible cross-NAT validation (NOT EXECUTED here)

> **Honest status: this experiment has NOT been run in the offline dev
> environment used for the P2P transport work.** It cannot be: both hosts
> would need genuinely different public IPs behind real NATs, which a single
> offline box (even with Docker and loopback tricks) cannot honestly
> reproduce — loopback always looks like a direct path. What IS executed is
> a related-but-weaker proof: `apps/desktop/scripts/p2p-two-process.mjs`
> drives two real OS processes through a relay and proves the relay cannot
> read (or corrupt) media. Treat everything on this page as instructions to
> reproduce the NAT findings on real networks, not as collected results.

## Why this exists

The transport selector (`apps/desktop/src/utils/transportState.ts`,
wired in `apps/desktop/src/hooks/useP2P.ts`) claims:

- direct WebRTC when ICE says so (DataChannel open = validated direct);
- relay through the courier node otherwise, labelled "relay via nó (NAT)";
- FAILOVER — direct attempts are bounded (12 s default); a failed direct
  never strands the peer, the relay session keeps working.

What it deliberately does NOT claim: that the courier RELAY solves the
worst NAT cases (hard symmetric NAT) for anything other than the relayed
path itself. WebRTC-ICE end-to-end guesses need real_nat environments.

## Runbook A — two real networks (strongest, simplest)

Works today, no containers:

1. Machine 1: home Wi-Fi. Machine 2: phone tethering (different carrier).
2. Both: checkout the same commit, `npm install`, `npm run electron`.
3. Open the chat roster on both, dial each other, and read the path label
   near the roster entry (`swarmTransportLabel` in useP2P.ts):
   `P2P direto` / `relay via nó (NAT)` / `sem rota`.
4. Record: which label, how long `connecting-direct` persisted (deadline =
   `createTransportRegistry` default `directDeadlineMs`, 12 s, in
   transportState.ts), and whether a media transfer completes (relay path
   proves E2E encryption works across asymmetric NAT: the courier must NOT
   see the media — the two-process harness proves that property for the
   relay code).
5. Swap order (relay first, then verify direct promotion when peers move to
   the same network — e.g. machine 1 leaves Wi-Fi and rejoins it).

## Runbook B — Docker symmetric NAT simulation (reproduces the worst case)

Topology: two peer containers, each behind its own MASQUERADE router on an
isolated bridge; the courier node sits on the uplink network. MASQUERADE
makes the external mapping IP:port symmetric — ICE reflexive candidates that
worked under (previously tested) restricted-cone cannot work here, so the
expected terminal transport is the relay.

    # nat-lab/docker-compose.yml (sketch to copy; this lab was NOT executed)
    networks: { uplink: {}, natA: { internal: true }, natB: { internal: true } }
    services:
      routerA:                      # and routerB, same shape, natB
        image: alpine:3.20
        privileged: true
        command: sh -c "apk add -q iptables &&
          echo 1 > /proc/sys/net/ipv4/ip_forward &&
          iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE"
        networks: [uplink, natA]
      peerA:
        image: node:22
        entrypoint: ["sh","-c","sleep infinity"]   # run harness workers / headless client here           # gateway = routerA; dial from this container
        networks: [natA]         # gateway = routerA
      courier:
        image: node:22
        command: ["sh","-c","cd /srv && npm run -w @orbit/api dev"]  # relay (courier) node
        networks: [uplink]

Steps: launch `docker compose up`, enter each peer container, point the
harness worker (or a headless client) at the courier via its uplink address,
dial peer↔peer, and record the success criteria below. A container lab only
APPROXIMATES a real ISP NAT — treat runbook A as the deciding evidence.

Success criteria (all recorded, none assumed):

| check | pass condition |
|---|---|
| bounded direct attempt | `connecting-direct` ends ≤ 12 s (`createTransportRegistry` default `directDeadlineMs` in transportState.ts) |
| honest fallback | phase → `relay`, app continues without restart |
| no silent degradation | the roster label (`swarmTransportLabel`) never claims `P2P direto` when the DataChannel never opened |
| media over relay | transfer completes; relay memory/frames contain no plaintext (two-process harness gives the in-repo proof) |
| cleanup | exiting the app removes the peer's transport entry from the registry (attempted via teardown in useP2P.ts) |

## What was verified without NATs (executed, in-repo)

- `apps/desktop/scripts/p2p-two-process.mjs` — two REAL processes + untrusted
  relay: clean transfer byte-identical, tampered chunk rejected, no plaintext
  in any relayed frame. This is repo-committed and can be re-run by anyone;
  it is evidence for the RELAY path semantics, not for NAT traversal.
- transport state machine unit tests (desktop vitest).

That is the boundary of honest claims: anything beyond it needs runbook A or B
on a network with two real NATs.
