import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export type PinTier = 'PERMANENT' | 'TEMPORARY' | 'LRU';

export interface BlockEntry {
  cid: string;
  data: Uint8Array;
  size: number;
  pinTier: PinTier;
  createdAt: number;
  lastAccessedAt: number;
}

export function computeCID(bytes: Uint8Array): string {
  const hash = sha256(bytes);
  return `bafybeig${bytesToHex(hash).slice(0, 52)}`;
}

export class HeliaBlockstore {
  private blocks: Map<string, BlockEntry> = new Map();
  private maxCacheSizeBytes: number = 100 * 1024 * 1024; // 100MB default cache

  constructor(maxCacheSizeBytes?: number) {
    if (maxCacheSizeBytes) {
      this.maxCacheSizeBytes = maxCacheSizeBytes;
    }
  }

  public async putBlock(bytes: Uint8Array, tier: PinTier = 'LRU'): Promise<string> {
    const cid = computeCID(bytes);
    const existing = this.blocks.get(cid);

    if (existing) {
      existing.lastAccessedAt = Date.now();
      if (tier === 'PERMANENT') existing.pinTier = 'PERMANENT';
      return cid;
    }

    const entry: BlockEntry = {
      cid,
      data: bytes,
      size: bytes.byteLength,
      pinTier: tier,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    this.blocks.set(cid, entry);
    this.evictIfNecessary();
    return cid;
  }

  public async getBlock(cid: string): Promise<Uint8Array | null> {
    const entry = this.blocks.get(cid);
    if (!entry) return null;
    entry.lastAccessedAt = Date.now();
    return entry.data;
  }

  public async hasBlock(cid: string): Promise<boolean> {
    return this.blocks.has(cid);
  }

  public async pinCID(cid: string, tier: PinTier): Promise<void> {
    const entry = this.blocks.get(cid);
    if (entry) {
      entry.pinTier = tier;
    }
  }

  /**
   * Chunks large payload into 256KB UnixFS blocks and returns root CID & manifest
   */
  public async importFile(bytes: Uint8Array, tier: PinTier = 'PERMANENT'): Promise<{ rootCID: string; chunkCIDs: string[] }> {
    const CHUNK_SIZE = 256 * 1024; // 256KB
    const chunkCIDs: string[] = [];

    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
      const chunkCID = await this.putBlock(chunk, tier);
      chunkCIDs.push(chunkCID);
    }

    // Create manifest root block mapping chunk CIDs
    const manifestJson = JSON.stringify({
      type: 'unixfs-manifest',
      totalSize: bytes.length,
      chunks: chunkCIDs,
    });
    const manifestBytes = new TextEncoder().encode(manifestJson);
    const rootCID = await this.putBlock(manifestBytes, tier);

    return { rootCID, chunkCIDs };
  }

  /**
   * Reassembles full binary file from root manifest CID
   */
  public async exportFile(rootCID: string): Promise<Uint8Array | null> {
    const manifestBlock = await this.getBlock(rootCID);
    if (!manifestBlock) return null;

    try {
      const manifestStr = new TextDecoder().decode(manifestBlock);
      const manifest = JSON.parse(manifestStr);

      if (manifest.type !== 'unixfs-manifest' || !Array.isArray(manifest.chunks)) {
        // Fallback: If not manifest, block itself is the entire file
        return manifestBlock;
      }

      const totalSize: number = manifest.totalSize;
      const result = new Uint8Array(totalSize);
      let offset = 0;

      for (const chunkCID of manifest.chunks) {
        const chunk = await this.getBlock(chunkCID);
        if (!chunk) {
          console.warn(`[Blockstore] Missing chunk block ${chunkCID} for root ${rootCID}`);
          return null;
        }
        result.set(chunk, offset);
        offset += chunk.length;
      }

      return result;
    } catch {
      // Single block file
      return manifestBlock;
    }
  }

  public getStats(): { totalBlocks: number; totalSizeBytes: number } {
    let totalSizeBytes = 0;
    for (const entry of this.blocks.values()) {
      totalSizeBytes += entry.size;
    }
    return {
      totalBlocks: this.blocks.size,
      totalSizeBytes,
    };
  }

  private evictIfNecessary() {
    let stats = this.getStats();
    if (stats.totalSizeBytes <= this.maxCacheSizeBytes) return;

    // Filter LRU blocks and sort by lastAccessedAt ascending
    const lruBlocks = Array.from(this.blocks.values())
      .filter((b) => b.pinTier === 'LRU')
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    for (const block of lruBlocks) {
      this.blocks.delete(block.cid);
      stats.totalSizeBytes -= block.size;
      if (stats.totalSizeBytes <= this.maxCacheSizeBytes) break;
    }
  }
}
