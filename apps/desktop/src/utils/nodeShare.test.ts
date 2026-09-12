import { describe, it, expect } from 'vitest';
import { buildNodeCode } from './nodeShare';
import { decodeNodeMask } from './nodeMask';

describe('buildNodeCode', () => {
  it('encodes host:port from a lanUrl with the server name', () => {
    const code = buildNodeCode('http://192.168.0.42:8790', 'Beach House')!;
    expect(code.startsWith('gmatch://node/')).toBe(true);
    expect(decodeNodeMask(code)).toEqual({ host: '192.168.0.42', port: 8790, name: 'Beach House' });
  });
  it('accepts a bare host:port hint', () => {
    const code = buildNodeCode('203.0.113.9:8790', 'Box')!;
    expect(decodeNodeMask(code)!.port).toBe(8790);
  });
  it('accepts a host without a port', () => {
    const code = buildNodeCode('node.example.com', 'Cloud')!;
    expect(decodeNodeMask(code)).toEqual({ host: 'node.example.com', port: null, name: 'Cloud' });
  });
  it('null on junk or missing name', () => {
    expect(buildNodeCode('not a url', 'x')).toBeNull();
    expect(buildNodeCode('http://a.b:8790', '')).toBeNull();
    expect(buildNodeCode('', 'x')).toBeNull();
  });
});
