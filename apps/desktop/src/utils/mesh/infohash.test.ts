// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  binaryBytes,
  binaryJson,
  dayStamp,
  infoHashBytes,
  infoHashHex,
  infoHashWindow,
} from './infohash';

const KEY = 'gmatch-community-key';

describe('rotating infohash', () => {
  it('is stable for the same key and day, and different for another day', async () => {
    const a = await infoHashHex(KEY, new Date('2026-11-14T10:00:00Z'));
    const b = await infoHashHex(KEY, new Date('2026-11-14T23:59:00Z'));
    const c = await infoHashHex(KEY, new Date('2026-11-15T00:01:00Z'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(40);
  });

  it('changes with the community key (closed community is a different mesh)', async () => {
    const open = await infoHashHex(KEY, new Date('2026-11-14T10:00:00Z'));
    const closed = await infoHashHex('another-key-entirely', new Date('2026-11-14T10:00:00Z'));
    expect(open).not.toBe(closed);
  });

  it('is 20 bytes, and the window covers yesterday/today/tomorrow', async () => {
    const bytes = await infoHashBytes(KEY, new Date('2026-11-14T12:00:00Z'));
    expect(bytes).toHaveLength(20);
    const window = await infoHashWindow(KEY, Date.parse('2026-11-14T12:00:00Z'));
    expect(window).toHaveLength(3);
    expect(window[0]).toHaveLength(20);
  });

  it('dayStamp is UTC, not local', () => {
    expect(dayStamp(new Date('2026-11-14T23:30:00-02:00'))).toBe('2026-11-15');
  });
});

describe('binary fields on the tracker wire', () => {
  it('escapes every byte, so high bytes survive JSON', () => {
    const bytes = new Uint8Array(20);
    for (let i = 0; i < 20; i++) bytes[i] = i === 0 ? 0xff : i;
    const encoded = binaryJson(bytes);
    expect(encoded.startsWith('\\u00ff')).toBe(true);
    // ASCII only: a raw binary string would emit multi-byte UTF-8 here.
    expect(/^[\x20-\x7e\\u]+$/.test(encoded)).toBe(true);

    const json = `{"info_hash":"${encoded}"}`;
    const parsed = JSON.parse(json) as { info_hash: string };
    expect(parsed.info_hash).toHaveLength(20);
    expect([...binaryBytes(parsed.info_hash)]).toEqual([...bytes]);
  });

  it('round-trips a real infohash', async () => {
    const bytes = await infoHashBytes(KEY, new Date('2026-11-14T12:00:00Z'));
    const parsed = JSON.parse(`{"info_hash":"${binaryJson(bytes)}"}`) as { info_hash: string };
    expect([...binaryBytes(parsed.info_hash)]).toEqual([...bytes]);
  });
});