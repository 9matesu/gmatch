// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { addPeer, buildPex, createPexTable, ingestPex, MAX_PEERS, PEER_INTERVAL_MS, prunePex } from './pex';

const id = (n: number) => n.toString(16).padStart(64, '0');
const me = id(1);

describe('PEX', () => {
  it('caps the table at 32 and keeps the newest', () => {
    const table = createPexTable();
    for (let i = 0; i < MAX_PEERS + 10; i++) addPeer(table, { orbitId: id(i + 2), at: Date.now() });
    expect(table.peers).toHaveLength(MAX_PEERS);
    expect(table.peers[0].orbitId).toBe(id(MAX_PEERS + 11));
  });

  it('refuses a duplicate id', () => {
    const table = createPexTable();
    expect(addPeer(table, { orbitId: id(2), at: Date.now() })).toBe(true);
    expect(addPeer(table, { orbitId: id(2), at: Date.now() })).toBe(false);
  });

  it('rejects a malformed id, but keeps a peer whose node url is unusable', () => {
    const table = createPexTable();
    expect(addPeer(table, { orbitId: 'nope', at: Date.now() })).toBe(false);
    // A bad node url is a missing field, not a fake peer: the id still counts.
    expect(addPeer(table, { orbitId: id(3), nodeUrl: 'ftp://x', at: Date.now() })).toBe(true);
    expect(table.peers[0].nodeUrl).toBeUndefined();
  });

  it('rate limits PEX to one per peer per minute', () => {
    const table = createPexTable();
    addPeer(table, { orbitId: id(2), at: Date.now() });
    const now = 1_000_000;
    expect(buildPex(table, me, now)).not.toBeNull();
    expect(buildPex(table, me, now + 1_000)).toBeNull();
    expect(buildPex(table, me, now + PEER_INTERVAL_MS)).not.toBeNull();
  });

  it('never forwards a peer to itself', () => {
    const table = createPexTable();
    addPeer(table, { orbitId: me, at: Date.now() });
    addPeer(table, { orbitId: id(9), at: Date.now() });
    expect(buildPex(table, me, Date.now())?.some((p) => p.orbitId === me)).toBe(false);
  });

  it('ignores a PEX from a peer we never verified', () => {
    const table = createPexTable();
    expect(ingestPex(table, id(7), { peers: [{ orbitId: id(8), at: Date.now() }] })).toBe(0);
    expect(table.peers).toHaveLength(0);
  });

  it('ingests a PEX from a verified peer, minus the sender', () => {
    const table = createPexTable();
    addPeer(table, { orbitId: id(7), at: Date.now() });
    const added = ingestPex(table, id(7), {
      peers: [
        { orbitId: id(8), at: Date.now() },
        { orbitId: id(7), at: Date.now() },
      ],
    });
    expect(added).toBe(1);
    expect(table.peers.map((p) => p.orbitId)).toContain(id(8));
  });

  it('prunes peers older than the window', () => {
    const table = createPexTable();
    addPeer(table, { orbitId: id(5), at: 1_000 });
    expect(prunePex(table, 6 * 60 * 60 * 1000, 1_000 + 7 * 60 * 60 * 1000)).toBe(1);
    expect(table.peers).toHaveLength(0);
    expect(table.verified.size).toBe(0);
  });
});