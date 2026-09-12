/**
 * Canonical legal documents (security plan Phase C / "blindagem jurídica").
 * SINGLE SOURCE OF TRUTH: the in-app LegalCenter, the CLI download (.md via
 * scripts/gen-legal.cjs) and the public site legal pages ALL render from
 * these strings; drift is impossible by construction, and CI fails if the
 * generated .md files are stale.
 *
 * English is the binding text. Each doc: version = date + bump counter
 * (acceptance is keyed to the FULL version map, so any doc bump re-gates
 * every logged-in user).
 */

export type LegalId = 'terms' | 'privacy' | 'community' | 'abuse' | 'records' | 'e2e-disclaimer'

export interface LegalDoc {
  id: LegalId
  title: string
  version: string
  updated: string
  jurisdiction: string
  /** Markdown-ish sections: '## heading' lines start a section; '-' bullet. */
  body: string[]
}

export const LEGAL_VERSION = '2026-09-11.2'

export const LEGAL_DOCS: Record<LegalId, LegalDoc> = {
  terms: {
    id: 'terms',
    title: 'Terms of Use',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'Brazil (LGPD); GDPR applies additionally where applicable',
    body: [
      '## 1. Eligibility and age',
      'gMatch is an adults-only application. You must be at least 18 years old (or the age of majority in your jurisdiction, if higher) to access, download or use the software. By accepting these Terms you represent and warrant that you meet this requirement. We perform no age verification: the declaration is yours and its falsity is your liability.',
      '## 2. What the software is',
      'gMatch is self-hostable software for an adult social network with gameplay (cards, duel, idle) and end-to-end-encrypted peer-to-peer communication. Whoever distributes the binary provides the SOFTWARE; it does not administer, edit or host the content you publish or exchange.',
      '## 3. Accounts, keys and self-custody',
      '- Your account is a cryptographic keypair generated and held ON YOUR DEVICE.',
      '- Nobody, not even the authors, can reset your password, recover your account or access your data without your key.',
      '- Lose the key backup and the account and local history are gone. This is a privacy feature, not a bug, and no support flow can reverse it.',
      '- You are solely responsible for safeguarding your keys and your device.',
      '## 4. Operating modes and trust',
      'The app runs in two modes with different trust models:',
      '- **Official site / courier:** the public server works only as a blind postman. It forwards encrypted envelopes it CANNOT open and never sees content, conversation identities, presence or the social graph.',
      '- **Full-node (your own or a third-party server):** you connect to a complete server that YOU (or whoever hosts it) administer. In this mode the server operator can read legacy private messages and post data as described in the Privacy Policy. Note what the SOFTWARE does and does not offer: the admin suite moderates reported cases, public content and in-game chat. It contains no bulk private-message browsing. A host with database access can always do more than its software exposes. Connecting to a third-party full-node is your choice and creates a trust relationship with that host.',
      '## 5. Conduct',
      'The software may not be used for: illegal content (including child sexual abuse material, content involving minors or persons unable to consent, bestiality, real non-consensual incest and non-consensual violence); harassment, stalking or intimidation; spam or abusive automation; attempts to de-anonymize other users; exploiting the reputation/currency system for fraud.',
      'The client enforces a technical content-tag blocklist. It is a mitigation, not a guarantee: what reaches your device is ultimately your control.',
      '## 6. User content and licenses',
      'You keep ownership of what you publish. By publishing you grant other users a personal, non-exclusive, revocable license to view the content WITHIN the application, and DM recipients a license to keep local copies (the app cannot control what a recipient does with what it received; no end-to-end DRM exists).',
      'You declare you have the right to publish what you send (including model releases where the law requires them).',
      '## 7. Termination',
      'You may leave at any time: delete the app and the account disappears from your side; in courier mode un-consumed envelopes expire by TTL and vanish. We cannot "delete you from a server" that is not ours, nor purge data we never had.',
      '## 8. Limitation of liability',
      'The software is provided "as is" and "as available" without warranties of any kind, to the maximum extent permitted by Brazilian law. The authors and distributors are NOT liable for: (a) content generated or shared by users; (b) data loss due to missing user backups; (c) unavailability or misbehaviour of third-party servers; (d) indirect damages, lost profits or offensive content seen on third-party full-nodes. In no event shall the authors\u0027 liability exceed the price paid for the software (zero).',
      '## 9. Changes',
      'These Terms carry a published version (above). Substantial changes require a fresh in-app acceptance by your account on the first login after the change. The accepted version is recorded locally.',
      '## 10. Governing law and venue',
      'These Terms are governed by the laws of the Federative Republic of Brazil. The venue is the domicile of the user, respecting consumer rights.',
    ],
  },

  privacy: {
    id: 'privacy',
    title: 'Privacy Policy (LGPD/GDPR)',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'LGPD (Lei 13.709/2018); GDPR for EU users',
    body: [
      '## 1. Who is the controller',
      'For the OFFICIAL SITE (blind courier + TURN): the maintainers of the official site, contactable through the in-app abuse channel (Settings → Help). For FULL-NODES: the administrator of that server is the controller of the data it holds; the software only implements what the host runs.',
      '## 2. Legal bases',
      'Contract performance (delivering the service you asked for) + legitimate interest (security/anti-abuse) + consent (accepting the Terms and enabling optional features such as uploads).',
      '## 3. What we do NOT collect (minimisation statement)',
      '- No content: the official courier receives only sealed envelopes (XChaCha20-Poly1305) and the delivery address = BLAKE3 hash of your public key. It cannot know who sent, what, or when you read.',
      '- No presence: site mode exposes nothing about who is online, the social graph, profiles or posts.',
      '- No IP: TURN credential requests use an ephemeral random identity per session; server logs record redacted IPs (last octet removed); the rate limiter keys buckets on a salted one-way hash, never the address itself; the app never displays a raw server address (masked as 203.0.•••.•••).',
      '- No telemetry: the application makes zero analytics, crash-report or beacon requests to third parties.',
      '- No cookies: the desktop software uses no cookies and no trackers.',
      '- Nothing on your disk beyond the session: images live ONLY in memory (RAM cache, gone at exit); keys and history are encrypted by the Windows DPAPI; content HTTP responses use Cache-Control: no-store.',
      '## 4. What IS processed, and by whom',
      '- **Official site:** delivery address (hash), envelope size, timestamps, TTL/per-box caps (anti-flood). Purpose: routing. Retention: up to 7 days (expiry) or immediately after a signed ack.',
      '- **Your machine:** the full identity, keys, threads, rooms, settings, game save. It never leaves to the site.',
      '- **Full-node (if you use one):** it stores posts, profiles, legacy DMs (encrypted with the SERVER key, so the host can read them), economies and admin logs. Check your host\u0027s policy.',
      '## 5. Data subject rights (art. 18 LGPD / arts. 15-22 GDPR)',
      'Confirmation, access, rectification, portability, deletion and consent withdrawal are exercised LOCALLY: export your identity in the app (portability) and delete it (deletion on your device); in courier mode envelopes expire by themselves. For the official site, since data is only hashes and sealed bytes, it cannot be linked to you, and deletion is baked into the architecture. For full-nodes, contact the host administrator.',
      '## 6. Security',
      'Ed25519 signatures on every mutation with anti-replay nonces; ECIES (X25519 + XChaCha20-Poly1305 + BLAKE3 KDF); short-lived HMAC TURN credentials; shape-only validation without content reads; strict CSP; ICE candidate sanitisation against IP leaks (mDNS/relay). The full audit is published at legal/security.html on the official site.',
      '## 7. International transfers and subprocessors',
      'The official site may be hosted on cloud outside Brazil; the only data processed there are opaque envelopes and hashes, without any decryption key. Self-hosted TURN is optional; we never use third-party clouds for content.',
      '## 8. Minors',
      'The service is for adults (18+). We do not intentionally collect minors\u0027 data; there is no age verification.',
      '## 9. Changes',
      'Substantial changes require fresh in-app acceptance. Current version: above and in the Legal Center screen.',
    ],
  },

  community: {
    id: 'community',
    title: 'Community Rules',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'Enforced technically client-side and by full-node hosts',
    body: [
      '## 1. Age and consent',
      '18+. All content must depict or simulate consent. Prohibited: minors, apparent minors, non-consent, real incest, bestiality, death/necrophilia, real coercion. The technical tag blocklist applies to all feeds and uploads.',
      '## 2. Others\u0027 privacy',
      'Never publish intimate imagery of another person without their consent. Revenge porn is a crime in Brazil (Lei 13.718/2018) and grounds for removal from any full-node.',
      '## 3. Respect',
      'No harassment, doxxing, hate speech, de-anonymization attempts ("outing") or IP hunting against other users.',
      '## 4. AI-generated content',
      'Allowed, as long as it violates no rule above and does not depict real people without consent.',
      '## 5. In-game currency',
      'The internal economy (g$) has no real value, is not convertible and not tradable outside the app. Exploiting bugs = balance loss.',
      '## 6. Enforcement',
      'In official courier mode NOBODY moderates: we do not read what you receive. Your tools are silent blocking, key disclosure (see the Abuse document) and the client-side technical filter. On full-nodes each host applies these rules on its own.',
    ],
  },

  abuse: {
    id: 'abuse',
    title: 'Abuse Reports & Notice-and-Takedown',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'MGA 512 (US) as reference; LGPD/CC Brazil for removal',
    body: [
      '## 1. The honest E2EE problem',
      'In official courier mode we DO NOT read content, and therefore cannot pre-moderate, judge reports about what we never saw, or selectively delete what we do not store. This is deliberate.',
      '## 2. What the architecture allows',
      '- **Victim key disclosure:** whoever received an envelope can export the key FOR THAT conversation/room. With the conversation key + the envelope, a human moderator can open and verify it against the signature. This only works for content the victim can access.',
      '- **Delivery address:** public and verifiable by whoever holds the matching private key. A court order that identifies a private key may, if the user complies, reveal its content.',
      '- **Full-nodes:** the host can read what you publish on it; reports go to the host and open as a CASE: the moderator sees the reported item and its disclosed evidence, nothing else.',
      '## 3. How to report',
      'Report through the in-app abuse channel (Settings → Help) or the abuse page on the official site. Include: a) your relationship to the case (victim/agent/stakeholder), b) description and, if possible, the envelopes and disclosed keys, c) a concrete identifier (delivery address), d) a good-faith statement under penalty of perjury.',
      '## 4. What we CANNOT do',
      'Generic surveillance orders ("show me the users"), requests without disclosed keys or legal basis, and removal of content from recipients\u0027 devices after delivery (we do not control receivers).',
      '## 5. Transparency',
      'Government requests will be honoured only under applicable law and published in a transparency report where allowed; no official-site key can decrypt user content because the site never held one.',
    ],
  },

  records: {
    id: 'records',
    title: 'Adult Content & Records (18 U.S.C. §2257-adjacent)',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'US (for publishers of explicit content under US jurisdiction); analogous local laws',
    body: [
      '## 1. Who is the "publisher"',
      'In the courier/P2P model there is NO central publisher: whoever submits is the publisher of their content and the custodian of their records. Publishing sexually explicit content in the US triggers 18 U.S.C. §2257 record-keeping duties; analogous laws may apply elsewhere.',
      '## 2. Where records live',
      'With the publisher, on their device. The software distributors receive, see and store none of your records. We offer no records-custody service and must not be treated as one.',
      '## 3. App tooling',
      'The app records locally the timestamp and signing key of every submission (signature inside the sealed envelope), provenance evidence that stays IN THE KEY HOLDER\u0027S HANDS, useful to prove authorship/date.',
      '## 4. No licence for illegality',
      'Nothing here authorises illegal content. Community rule 1 prevails: the software may not be used for content involving minors or non-consent under any law.',
    ],
  },

  'e2e-disclaimer': {
    id: 'e2e-disclaimer',
    title: 'Encryption & Self-Custody Disclaimer',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'Technical explanation tied to Terms §8',
    body: [
      '## 1. What the official server NEVER sees',
      'DM/post/room content or names; who talks to whom (the courier routes hashes; you map IDs to your box locally); who is online; your images, text or history.',
      '## 2. What it DOES see',
      'The delivery address, a one-way hash of your public key that ROTATES every session (contacts learn the new address from inside the sealed messages themselves), with minimal metadata (size, time, TTL) and anonymous TURN credential requests. Images you upload leave with pixels only: every metadata container (EXIF/GPS, XMP, text chunks) is stripped on the way in.',
      '## 3. Keys: what self-custody means',
      'Private keys live only on your device (DPAPI-encrypted on Windows when available). No server can "reset my password". Lose the backup, lose the account. No exceptions.',
      '## 4. TOFU (trust-on-first-use)',
      'The app FIXES a contact\u0027s public key when you first encrypt a conversation. If the key changes you are warned explicitly before sending. There is no trusted identity directory to audit, so out-of-band verification (e.g. comparing the hash in a channel both sides trust) is the only defence against a key-swap MITM.',
      '## 5. Honest limits',
      '- Courier timing metadata can correlate traffic under strong surveillance (no padding/onion by default).',
      '- A third-party full-node can read everything passing through it ("the host IS the server").',
      '- Malware running as your session user can read memory. That threat is your environment\u0027s.',
      '## 6. No recovery support',
      '"Reset my account" support requests are refused by principle: fulfilling them would break the promise of this document.',
    ],
  },
}

/** All version pairs for acceptance-key bookkeeping. */
export function legalVersionKey(): string {
  return Object.values(LEGAL_DOCS)
    .map((d) => `${d.id}@${d.version}`)
    .sort()
    .join(';')
}

export const LEGAL_IDS: LegalId[] = Object.keys(LEGAL_DOCS) as LegalId[]
