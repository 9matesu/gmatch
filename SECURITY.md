# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**). Please do not open a public issue for
an unfixed vulnerability.

Include, as far as you can:

- the affected component (app, node, protocol package) and version;
- a description of the impact and the preconditions;
- a minimal reproduction, or the exact code path you believe is wrong;
- whether the issue is already public anywhere.

No bug bounty is offered. Reports are acknowledged on a best-effort basis, and
fixes are shipped with a release note that credits the reporter unless asked
otherwise.

## Scope

In scope:

- `apps/desktop` — Electron main/preload and renderer, including the local
  node bridge and the swarm engine;
- `apps/api` — node routes and storage;
- `packages/protocol`, `packages/crypto` — signed operations, envelope and
  AEAD wire formats;
- `site` — the static release page and its hash-verification pipeline.

Out of scope: findings that require a compromised device or a leaked private
key (client-side cryptography cannot defend against either), and issues that
only affect an outdated release.

## Known historical exposure

`apps/api/storage.key` was tracked in this repository until version 1.6.2 and
remains readable in the Git history. It is the at-rest key that
`resolveStorageKey()` generates for a node whose database sits in the checkout;
it is no longer tracked (`git rm --cached`) and `storage.key` is ignored at any
depth.

Treat that key as compromised wherever it was used. Delete the file and start
the node again: `resolveStorageKey()` generates a fresh 32-byte key with the
platform CSPRNG and writes it next to the snapshot. Blobs and snapshots
encrypted under the old key cannot be re-keyed in place; export what you can
read and re-import it into the fresh store.

## What "secure" means here

The project publishes a white-box audit (`docs/SECURITY-AUDIT.md`) and
reproducible evidence for the claims it makes about the transport
(`apps/desktop/scripts/p2p-two-process.mjs`, `apps/desktop/nat-lab/README.md`).
Known limits are listed in `docs/SECURITY.md` and on the release page; a claim
that exceeds them is treated as a documentation bug.
