"use client";

import { signMessage, bytesToHex } from '@orbit/crypto';
import { orbitFetch, type OrbitIdentityLike } from '../utils/api';
import {
  gossipSigningMessage,
  type GossipEnvelope,
  type GossipPostPayload,
} from '@orbit/shared';

/**
 * Self-hosting relay client (plan G1).
 *
 * After a PUBLIC upload registers on our own node, we also drop a SIGNED
 * envelope on that node's gossip relay. Other hosts pull it into their own
 * dbs; media bytes stay local-first (P2P swarm) — only post metadata travels.
 * Private content (DMs, stories, avatars, chats) never enters gossip: the
 * caller gates on the same isPublic/isStory/isChat/isAvatar flags.
 */

export interface GossipPostInput {
  id: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  magnetUri: string;
  caption?: string;
  location?: string;
  tags?: string;
  postGroup?: string | null;
  authorName?: string;
}

function displayNameFallback(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('orbit_display_name') || '';
    }
  } catch { /* private mode */ }
  return '';
}

export function buildGossipPayload(
  identity: OrbitIdentityLike,
  input: GossipPostInput,
): GossipPostPayload {
  return {
    id: input.id,
    owner_id: identity.orbitId,
    author_pubkey: identity.publicKeyHex,
    author_name: (input.authorName || displayNameFallback()).slice(0, 80),
    mime_type: input.mimeType || 'application/octet-stream',
    size_bytes: input.sizeBytes,
    content_url: input.magnetUri || (input.contentHash ? `urn:sha256:${input.contentHash}` : `/api/objects/${input.id}`),
    caption: input.caption || null,
    location: input.location || null,
    post_tags: input.tags || null,
    post_group: input.postGroup || null,
    content_hash: /^[0-9a-f]{64}$/i.test(input.contentHash || '') ? input.contentHash.toLowerCase() : null,
    created_at: new Date().toISOString(),
  };
}

export function signGossipPayload(payload: GossipPostPayload, privateKeyHex: string): string {
  return bytesToHex(signMessage(gossipSigningMessage(payload), privateKeyHex));
}

/**
 * Best-effort gossip of one own public post. Resolves true when the relay
 * stored (or deduped) it, false on any failure — callers fire-and-forget.
 */
export async function gossipOwnPost(
  identity: OrbitIdentityLike,
  input: GossipPostInput,
): Promise<boolean> {
  try {
    const payload = buildGossipPayload(identity, input);
    const envelope: GossipEnvelope = {
      kind: 'post',
      id: payload.id,
      author_id: payload.owner_id,
      payload,
      sig: signGossipPayload(payload, identity.privateKeyHex),
    };
    const res = await orbitFetch('/api/gossip/envelopes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    }, identity);
    return res.ok;
  } catch {
    return false;
  }
}
