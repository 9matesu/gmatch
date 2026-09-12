import { describe, expect, it } from 'vitest'
import { maskIp, maskedServerUrl } from './ipMask'

describe('ipMask', () => {
  it('masks dotted-quad IPv4 in urls', () => {
    const out = maskedServerUrl('http://192.168.4.71:8790')
    expect(out).not.toContain('4.71')
    expect(out).toContain('192.168')
    expect(out).toContain('8790')
  })
  it('leaves hostnames and localhost alone', () => {
    expect(maskedServerUrl('https://gmatch.fly.dev')).toBe('https://gmatch.fly.dev')
    expect(maskedServerUrl('http://localhost:8790')).toBe('http://localhost:8790')
  })
  it('masks bare ips in arbitrary text', () => {
    expect(maskIp('peer at 10.0.3.245 joined')).not.toContain('3.245')
  })
})
