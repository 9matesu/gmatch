import { OrbitIdentity, encryptPayload, decryptPayload, signMessage, verifySignature } from '@orbit/crypto';
import { HeliaBlockstore, PinTier } from './blockstore';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export type EventType = 'IMAGE_ANNOUNCE' | 'CHAT_MESSAGE' | 'PRESENCE' | 'BLOCK_REQUEST' | 'BLOCK_RESPONSE';

export interface P2PEventPayload {
  type: EventType;
  senderOrbitId: string;
  senderPubKeyHex: string;
  senderEncPubHex: string;
  timestamp: number;
  nonceHex: string;
  cid?: string;
  mimeType?: string;
  caption?: string;
  encryptedContentBase64?: string;
  blockCID?: string;
  blockDataHex?: string;
  signatureHex?: string;
}

export type EventCallback = (event: P2PEventPayload, fromPeerId: string) => void;

export class OrbitP2PNode {
  public identity: OrbitIdentity;
  public blockstore: HeliaBlockstore;
  public connectedPeers: Map<string, OrbitP2PNode> = new Map();
  private topicSubscribers: Map<string, Set<EventCallback>> = new Map();
  private seenEvents: Set<string> = new Set();

  constructor(identity: OrbitIdentity, blockstore?: HeliaBlockstore) {
    this.identity = identity;
    this.blockstore = blockstore || new HeliaBlockstore();
  }

  public connectPeer(peer: OrbitP2PNode) {
    if (peer.identity.orbitId === this.identity.orbitId) return;
    this.connectedPeers.set(peer.identity.orbitId, peer);
    peer.connectedPeers.set(this.identity.orbitId, this);
  }

  public disconnectPeer(peerId: string) {
    const peer = this.connectedPeers.get(peerId);
    if (peer) {
      peer.connectedPeers.delete(this.identity.orbitId);
      this.connectedPeers.delete(peerId);
    }
  }

  public subscribe(topic: string, callback: EventCallback) {
    if (!this.topicSubscribers.has(topic)) {
      this.topicSubscribers.set(topic, new Set());
    }
    this.topicSubscribers.get(topic)!.add(callback);
  }

  public publish(topic: string, event: P2PEventPayload) {
    // Sign event payload with Ed25519 key
    const messageBytes = new TextEncoder().encode(`${event.type}:${event.senderOrbitId}:${event.timestamp}:${event.nonceHex}:${event.cid || ''}`);
    const signature = signMessage(messageBytes, this.identity.privateKeyHex);
    event.signatureHex = bytesToHex(signature);

    const eventHash = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(event))));
    this.seenEvents.add(eventHash);

    // Broadcast to connected peers via GossipSub simulation
    this.broadcastToSwarm(topic, event, eventHash, this.identity.orbitId);
  }

  private broadcastToSwarm(topic: string, event: P2PEventPayload, eventHash: string, originPeerId: string) {
    for (const [peerId, peer] of this.connectedPeers.entries()) {
      if (peer.seenEvents.has(eventHash)) continue;
      peer.seenEvents.add(eventHash);
      peer.receiveGossip(topic, event, originPeerId);
      // Gossip propagation across swarm mesh
      peer.broadcastToSwarm(topic, event, eventHash, originPeerId);
    }
  }

  public receiveGossip(topic: string, event: P2PEventPayload, fromPeerId: string) {
    // Verify signature
    if (event.signatureHex) {
      const messageBytes = new TextEncoder().encode(`${event.type}:${event.senderOrbitId}:${event.timestamp}:${event.nonceHex}:${event.cid || ''}`);
      const isValid = verifySignature(
        new Uint8Array(event.signatureHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))),
        messageBytes,
        event.senderPubKeyHex
      );
      if (!isValid) {
        console.warn(`[P2PNode] Invalid signature received from peer ${fromPeerId}`);
        return;
      }
    }

    // Handle internal block requests automatically
    if (event.type === 'BLOCK_REQUEST' && event.blockCID) {
      this.handleBlockRequest(event.blockCID, fromPeerId);
    }

    const subscribers = this.topicSubscribers.get(topic);
    if (subscribers) {
      for (const cb of subscribers) {
        cb(event, fromPeerId);
      }
    }
  }

  /**
   * Encrypts image binary with XChaCha20-Poly1305, imports into Helia blockstore, and publishes CID event over GossipSub
   */
  public async publishEncryptedImage(
    imageBytes: Uint8Array,
    recipientEncPubHex: string,
    mimeType: string = 'image/webp',
    caption: string = ''
  ): Promise<{ cid: string; event: P2PEventPayload }> {
    // 1. Encrypt image payload using sender private key + recipient public key
    const encryptedBytes = encryptPayload(imageBytes, this.identity.encryptionPrivHex, recipientEncPubHex);

    // 2. Import into Helia UnixFS Blockstore
    const { rootCID } = await this.blockstore.importFile(encryptedBytes, 'PERMANENT');

    // 3. Create signed announcement event
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const nonceHex = bytesToHex(nonce);

    const event: P2PEventPayload = {
      type: 'IMAGE_ANNOUNCE',
      senderOrbitId: this.identity.orbitId,
      senderPubKeyHex: this.identity.publicKeyHex,
      senderEncPubHex: this.identity.encryptionPubHex,
      timestamp: Date.now(),
      nonceHex,
      cid: rootCID,
      mimeType,
      caption,
    };

    // 4. Publish to network topic
    this.publish('orbit/v1/feed', event);

    return { cid: rootCID, event };
  }

  /**
   * Fetches an IPFS CID from local blockstore or requests blocks from connected swarm peers
   */
  public async fetchAndDecryptImage(
    cid: string,
    senderEncPubHex: string,
    timeoutMs: number = 5000
  ): Promise<Uint8Array | null> {
    // 1. Check local blockstore
    let encryptedBytes = await this.blockstore.exportFile(cid);

    // 2. If missing, request blocks from connected swarm peers
    if (!encryptedBytes) {
      encryptedBytes = await this.requestCIDFromSwarm(cid, timeoutMs);
    }

    if (!encryptedBytes) {
      console.warn(`[P2PNode ${this.identity.orbitId}] Failed to retrieve CID ${cid} from swarm`);
      return null;
    }

    // 3. Decrypt payload using recipient private key + sender public key
    try {
      const decrypted = decryptPayload(encryptedBytes, this.identity.encryptionPrivHex, senderEncPubHex);
      return decrypted;
    } catch (err) {
      console.error(`[P2PNode] Decryption failed for CID ${cid}:`, err);
      return null;
    }
  }

  private async requestCIDFromSwarm(cid: string, timeoutMs: number): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, timeoutMs);

      // Listen for incoming block responses
      const blockResponseHandler = async (event: P2PEventPayload) => {
        if (event.type === 'BLOCK_RESPONSE' && event.cid === cid && event.blockDataHex) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            const dataBytes = new Uint8Array(event.blockDataHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
            // Save received bytes to local blockstore & seed
            await this.blockstore.putBlock(dataBytes, 'TEMPORARY');
            resolve(dataBytes);
          }
        }
      };

      this.subscribe('orbit/v1/blocks', blockResponseHandler);

      // Broadcast block request to swarm
      const nonceHex = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const requestEvent: P2PEventPayload = {
        type: 'BLOCK_REQUEST',
        senderOrbitId: this.identity.orbitId,
        senderPubKeyHex: this.identity.publicKeyHex,
        senderEncPubHex: this.identity.encryptionPubHex,
        timestamp: Date.now(),
        nonceHex,
        blockCID: cid,
      };

      this.publish('orbit/v1/blocks', requestEvent);
    });
  }

  private async handleBlockRequest(blockCID: string, requestingPeerId: string) {
    const fileBytes = await this.blockstore.exportFile(blockCID);
    if (!fileBytes) return;

    const peer = this.connectedPeers.get(requestingPeerId);
    if (!peer) return;

    const nonceHex = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const responseEvent: P2PEventPayload = {
      type: 'BLOCK_RESPONSE',
      senderOrbitId: this.identity.orbitId,
      senderPubKeyHex: this.identity.publicKeyHex,
      senderEncPubHex: this.identity.encryptionPubHex,
      timestamp: Date.now(),
      nonceHex,
      cid: blockCID,
      blockDataHex: bytesToHex(fileBytes),
    };

    peer.receiveGossip('orbit/v1/blocks', responseEvent, this.identity.orbitId);
  }
}
