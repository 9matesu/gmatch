# Encryption & Self-Custody Disclaimer

_Binding text (EN)_: **2026-11-07.1** · updated: 2026-11-07
Jurisdiction: Technical explanation tied to Terms §8

## 1. What a RELAY never sees

DM/post/room content or names; who talks to whom (the node routes hashes; you map IDs to your box locally); who is online on other nodes; your images, text or history.

## 2. What it DOES see

The delivery address, a one-way hash of your public key that ROTATES every session (contacts learn the new address from inside the sealed messages themselves), with minimal metadata (size, time, TTL). It also sees the network connection itself, so it knows your IP address as any peer does. Images you upload leave with pixels only: every metadata container (EXIF/GPS, XMP, text chunks) is stripped on the way in.

## 3. Keys: what self-custody means

Private keys live only on your device (DPAPI-encrypted on Windows when available). No server can "reset my password". Lose the backup, lose the account. No exceptions.

## 4. TOFU (trust-on-first-use)

The app FIXES a contact's public key when you first encrypt a conversation. If the key changes you are warned explicitly before sending. There is no trusted identity directory to audit, so out-of-band verification (e.g. comparing the hash in a channel both sides trust) is the only defence against a key-swap MITM.

## 5. Honest limits

- Node timing metadata can correlate traffic under strong surveillance (no padding/onion by default).

- A third-party full-node can read everything passing through it ("the host IS the server").

- Malware running as your session user can read memory. That threat is your environment's.

## 6. No recovery support

"Reset my account" support requests are refused by principle: fulfilling them would break the promise of this document.
