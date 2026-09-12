import { describe, it, expect } from 'vitest'
import { encodeNodeMask, decodeNodeMask, nodeMaskDisplayLabel } from './nodeMask'

describe('node mask (D1)', () => {
  it('round-trips host/port/name', () => {
    const code = encodeNodeMask('203.0.113.7', 8790, 'LAN box')!
    expect(code.startsWith('gmatch://node/')).toBe(true)
    expect(decodeNodeMask(code)).toEqual({ host: '203.0.113.7', port: 8790, name: 'LAN box' })
  })
  it('port is optional', () => {
    const c = decodeNodeMask(encodeNodeMask('node.example.com', null, 'cloud')!)
    expect(c).toEqual({ host: 'node.example.com', port: null, name: 'cloud' })
  })
  it('rejects traversal, oversized names, bad ports, junk', () => {
    expect(encodeNodeMask('../../etc', 80, 'x')).toBeNull()
    expect(encodeNodeMask('host', 80, 'x'.repeat(41))).toBeNull()
    expect(encodeNodeMask('host', 70000, 'x')).toBeNull()
    expect(decodeNodeMask('gmatch://node/not-base64!!')).toBeNull()
    expect(decodeNodeMask('https://evil/x')).toBeNull()
    expect(decodeNodeMask('gmatch://node/' + btoa('{"h":"a","p":80,"n":"' + 'y'.repeat(50) + '"}'))).toBeNull()
  })
  it('display label masks the IP', () => {
    expect(nodeMaskDisplayLabel(encodeNodeMask('203.0.113.7', 8790, 'n')!)).toBe('203.0.•••.•••:8790')
  })
})
