import { describe, it, expect } from 'vitest';
import { generateIdentity } from '@orbit/crypto';
import { OrbitP2PNode } from './p2p-node';
import { HeliaBlockstore, computeCID } from './blockstore';

describe('Helia Blockstore & UnixFS Chunking', () => {
  it('should chunk file into 256KB UnixFS blocks and generate root CID', async () => {
    const blockstore = new HeliaBlockstore();
    const fakeImageBuffer = new Uint8Array(600 * 1024); // 600KB file > 2 x 256KB chunks
    for (let i = 0; i < fakeImageBuffer.length; i += 65536) {
      const slice = fakeImageBuffer.subarray(i, Math.min(i + 65536, fakeImageBuffer.length));
      crypto.getRandomValues(slice);
    }


    const { rootCID, chunkCIDs } = await blockstore.importFile(fakeImageBuffer, 'PERMANENT');

    expect(rootCID).toMatch(/^bafybeig/);
    expect(chunkCIDs.length).toBe(3); // 256KB + 256KB + 88KB = 3 chunks

    const reassembled = await blockstore.exportFile(rootCID);
    expect(reassembled).not.toBeNull();
    expect(reassembled?.length).toBe(fakeImageBuffer.length);
    expect(reassembled).toEqual(fakeImageBuffer);
  });
});

describe('2-Browser P2P Swarm Integration Test', () => {
  it('should publish encrypted image on Peer A, sync CID to Peer B, fetch blocks over P2P, and decrypt cleanly', async () => {
    // 1. Initialize Peer A (Uploader) and Peer B (Recipient/Viewer)
    const identityA = generateIdentity();
    const identityB = generateIdentity();

    const nodeA = new OrbitP2PNode(identityA);
    const nodeB = new OrbitP2PNode(identityB);

    // Connect Node A and Node B into a P2P Mesh
    nodeA.connectPeer(nodeB);
    expect(nodeA.connectedPeers.size).toBe(1);
    expect(nodeB.connectedPeers.size).toBe(1);

    // Set up GossipSub feed listener on Peer B
    let receivedAnnouncement: any = null;
    nodeB.subscribe('orbit/v1/feed', (event) => {
      receivedAnnouncement = event;
    });

    // 2. Peer A creates a test high-resolution image payload
    const originalImageBytes = new Uint8Array(512 * 1024); // 512KB image
    for (let i = 0; i < originalImageBytes.length; i++) {
      originalImageBytes[i] = i % 256;
    }

    // 3. Peer A encrypts payload for Peer B, generates Helia IPFS CID, and broadcasts announcement
    const { cid } = await nodeA.publishEncryptedImage(
      originalImageBytes,
      identityB.encryptionPubHex,
      'image/jpeg',
      'P2P Decentralized Test Image'
    );

    expect(cid).toMatch(/^bafybeig/);
    expect(receivedAnnouncement).not.toBeNull();
    expect(receivedAnnouncement.cid).toBe(cid);
    expect(receivedAnnouncement.senderOrbitId).toBe(identityA.orbitId);

    // 4. Peer B requests missing CID blocks from Peer A over P2P swarm and decrypts
    const decryptedImageBytes = await nodeB.fetchAndDecryptImage(
      receivedAnnouncement.cid,
      identityA.encryptionPubHex,
      3000
    );

    expect(decryptedImageBytes).not.toBeNull();
    expect(decryptedImageBytes?.length).toBe(originalImageBytes.length);
    expect(decryptedImageBytes).toEqual(originalImageBytes);

    // 5. Verify Peer B now has the blocks in its local blockstore and can act as a seeder
    const peerBBlockStats = nodeB.blockstore.getStats();
    expect(peerBBlockStats.totalBlocks).toBeGreaterThan(0);
  });
});
