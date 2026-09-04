"use client";

import {
  ContentManifest,
  DEFAULT_CHUNK_SIZE,
  decryptContent,
  decryptMetadata,
  encryptContent,
  encryptMetadata,
  generateDek,
  hexToBytes,
  signContentManifest,
  wrapDekForMultipleRecipients,
  unwrapDek,
} from '@orbit/crypto';
import { getEncryptedContent, saveEncryptedContent, touchContentAccess, type EncryptedContentRecord } from './storage';

export interface EncryptedFile {
  manifest: ContentManifest;
  record: EncryptedContentRecord;
  dek: Uint8Array;
}

export interface EncryptFileOptions {
  creatorId: string;
  creatorEncryptionPrivateKeyHex: string;
  recipientEncryptionPublicKeys: string[];
  adminEncryptionPublicKeyHex?: string;
  caption?: string;
  tags?: string[];
  chunkSize?: number;
  id?: string;
}

export interface DecryptFileOptions {
  recipientEncryptionPrivateKeyHex: string;
  recipientEncryptionPublicKeyHex: string;
  creatorEncryptionPublicKeyHex: string;
}

/**
 * Encrypt a file before it enters the network. Only ciphertext chunks and the
 * recipient-wrapped DEK should leave this function.
 */
export async function encryptFileForRecipients(file: File, options: EncryptFileOptions): Promise<EncryptedFile> {
  if (!file.size) throw new Error('Cannot encrypt an empty file');
  if (!options.recipientEncryptionPublicKeys.length) {
    throw new Error('At least one encryption recipient is required');
  }

  const plaintext = new Uint8Array(await file.arrayBuffer());
  const dek = generateDek();
  const encrypted = encryptContent(plaintext, dek, options.chunkSize || DEFAULT_CHUNK_SIZE);
  const now = Date.now();
  const id = options.id || crypto.randomUUID();
  const recipientKeys = Array.from(new Set([
    ...options.recipientEncryptionPublicKeys,
    ...(options.adminEncryptionPublicKeyHex ? [options.adminEncryptionPublicKeyHex] : []),
  ]));
  const wrappedKeys = wrapDekForMultipleRecipients(
    dek,
    options.creatorEncryptionPrivateKeyHex,
    recipientKeys,
  );
  const metadata = encryptMetadata({ caption: options.caption, tags: options.tags }, dek);

  const manifest: ContentManifest = {
    version: 1,
    cid: encrypted.contentCid,
    totalSize: encrypted.totalSize,
    chunkSize: options.chunkSize || DEFAULT_CHUNK_SIZE,
    chunks: encrypted.chunks.map((chunk) => ({
      cid: chunk.cid,
      offset: chunk.offset,
      size: chunk.size,
      nonceHex: bytesToHexLocal(chunk.nonce),
    })),
    mimeType: file.type || 'application/octet-stream',
    creatorId: options.creatorId,
    createdAt: now,
    wrappedKeys,
    metadata,
  };
  manifest.signatureHex = signContentManifest(manifest, options.creatorEncryptionPrivateKeyHex);

  const record: EncryptedContentRecord = {
    id,
    manifest,
    chunks: encrypted.chunks.map((chunk) => ({
      cid: chunk.cid,
      ciphertext: chunk.ciphertext.buffer.slice(
        chunk.ciphertext.byteOffset,
        chunk.ciphertext.byteOffset + chunk.ciphertext.byteLength,
      ) as ArrayBuffer,
      nonceHex: bytesToHexLocal(chunk.nonce),
      offset: chunk.offset,
      size: chunk.size,
    })),
    creatorId: options.creatorId,
    createdAt: now,
    isPinned: true,
    lastAccessedAt: now,
  };

  await saveEncryptedContent(record);
  return { manifest, record, dek };
}

export async function decryptStoredContent(
  id: string,
  options: DecryptFileOptions,
): Promise<{ plaintext: Uint8Array; mimeType: string; caption?: string; tags?: string[] } | null> {
  const record = await getEncryptedContent(id);
  if (!record) return null;

  const wrapped = record.manifest.wrappedKeys.find(
    (key) => key.recipientPubHex === options.recipientEncryptionPublicKeyHex,
  );
  if (!wrapped) throw new Error('No wrapped key is present for this content');

  const dek = unwrapDek(
    hexToBytes(wrapped.wrappedDekHex),
    options.recipientEncryptionPrivateKeyHex,
    options.creatorEncryptionPublicKeyHex,
  );
  const chunks = record.chunks.map((chunk) => ({
    ciphertext: new Uint8Array(chunk.ciphertext),
    nonce: hexToBytes(chunk.nonceHex),
    offset: chunk.offset,
    size: chunk.size,
  }));
  const plaintext = decryptContent(chunks, dek, record.manifest.totalSize);
  const metadata = record.manifest.metadata
    ? decryptMetadata(record.manifest.metadata, dek)
    : {};

  await touchContentAccess(id);
  return { plaintext, mimeType: record.manifest.mimeType, ...metadata };
}

function bytesToHexLocal(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}
