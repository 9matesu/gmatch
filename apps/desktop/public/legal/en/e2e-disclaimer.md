# Encryption & Self-Custody Disclaimer

_Informational translation (EN) — PT-BR binds_: **2026-09-09.1** · atualizado/updated: 2026-09-09
Jurisdição: Technical explanation tied to Terms §8

## 1. What the official server NEVER sees

DM/post/room content or names; who talks to whom (the courier routes hashes — you map IDs to your box locally); who is online; your images, text or history.

## 2. What it DOES see

The delivery address (hash of your public key) with minimal metadata (size, time, TTL) and anonymous TURN credential requests.

## 3. Keys: what self-custody means

Private keys live only on your device (DPAPI-encrypted on Windows when available). No server can "reset my password". Lose the backup, lose the account — no exceptions.

## 4. TOFU (trust-on-first-use)

The app FIXES a contact's public key when you first encrypt a conversation. If the key changes you are warned explicitly before sending. There is no trusted identity directory to audit — out-of-band verification (e.g. comparing the hash in a channel both sides trust) is the only defence against a key-swap MITM.

## 5. Honest limits

- Courier timing metadata can correlate traffic under strong surveillance (no padding/onion by default).

- A third-party full-node can read everything passing through it ("the host IS the server").

- Malware running as your session user can read memory — that threat is your environment's.

## 6. No recovery support

"Reset my account" support requests are refused by principle: fulfilling them would break the promise of this document.
