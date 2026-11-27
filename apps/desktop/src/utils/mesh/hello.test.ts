// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { generateIdentity } from '@orbit/crypto';
import {
  exchangeHello,
  fingerprintFromSdp,
  helloTranscript,
  makeHello,
  signHello,
  verifyHello,
  type HelloWire,
} from './hello';

const alice = generateIdentity();
const bob = generateIdentity();

const FP_A = 'aa'.repeat(32);
const FP_B = 'bb'.repeat(32);

function pair() {
  const helloA = makeHello(alice, FP_A);
  const helloB = makeHello(bob, FP_B);
  return { helloA, helloB, signedA: signHello(alice, helloA, helloB), signedB: signHello(bob, helloB, helloA) };
}

/** Two channel ends that deliver on a microtask, like a real DataChannel. */
function loopback(): [HelloWire, HelloWire] {
  const ends = [0, 1].map(() => ({ inbox: [] as string[], listeners: [] as Array<(t: string) => void> }));
  const drain = (side: (typeof ends)[number]) => {
    queueMicrotask(() => {
      while (side.inbox.length > 0) {
        const text = side.inbox.shift()!;
        for (const cb of [...side.listeners]) cb(text);
      }
    });
  };
  const make = (self: (typeof ends)[number], peer: (typeof ends)[number]): HelloWire => ({
    send: (t) => {
      peer.inbox.push(t);
      drain(peer);
    },
    onMessage: (cb) => {
      self.listeners.push(cb);
      drain(self);
      return () => {
        const i = self.listeners.indexOf(cb);
        if (i >= 0) self.listeners.splice(i, 1);
      };
    },
  });
  return [make(ends[0], ends[1]), make(ends[1], ends[0])];
}

describe('HELLO', () => {
  it('accepts a valid exchange and both sides agree', async () => {
    const [a, b] = loopback();
    const [ra, rb] = await Promise.all([exchangeHello(a, alice, FP_A, 2000), exchangeHello(b, bob, FP_B, 2000)]);
    expect(ra).not.toBeNull();
    expect(rb).not.toBeNull();
    expect(ra!.remote.orbitId).toBe(bob.orbitId);
    expect(rb!.remote.orbitId).toBe(alice.orbitId);
    expect(ra!.local.sig).toBe(rb!.remote.sig);
  });

  it('rejects a swapped DTLS fingerprint (MITM on the signaling)', () => {
    const { helloA, signedB } = pair();
    expect(verifyHello({ ...signedB, fp: FP_A }, helloA)).toBe(false);
  });

  it('rejects an altered signature', () => {
    const { helloA, signedB } = pair();
    const sig = signedB.sig.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
    expect(verifyHello({ ...signedB, sig }, helloA)).toBe(false);
  });

  it('rejects an orbitId that is not the hash of the declared key', () => {
    const { helloA, signedB } = pair();
    expect(verifyHello({ ...signedB, orbitId: generateIdentity().orbitId }, helloA)).toBe(false);
  });

  it('binds the signature to this session (a replay from another pair fails)', () => {
    const first = pair();
    const second = pair();
    expect(verifyHello(first.signedB, second.helloA)).toBe(false);
  });

  it('fingerprintFromSdp reads the sha-256 line and tolerates colons', () => {
    expect(fingerprintFromSdp('v=0\r\na=fingerprint:sha-256 AA:BB:CC\r\n')).toBe('aabbcc');
    expect(fingerprintFromSdp(null)).toBe('');
  });

  it('transcript includes both ends, in a fixed order', () => {
    const { helloA, helloB } = pair();
    const text = new TextDecoder().decode(helloTranscript(helloA, helloB));
    expect(text.split('|')).toHaveLength(5);
    expect(text.startsWith('mesh-hello-v1|')).toBe(true);
    expect(text).toContain(helloA.fp);
    expect(text).toContain(helloB.fp);
  });

  it('times out when the far end never answers', async () => {
    const wire: HelloWire = { send: () => {}, onMessage: () => () => {} };
    await expect(exchangeHello(wire, alice, FP_A, 60)).resolves.toBeNull();
  });
});