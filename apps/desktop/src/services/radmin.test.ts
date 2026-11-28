import { describe, expect, it, vi } from 'vitest'
import { firstRadminIp, joinRadminVlanWith, type RadminDeps } from './radmin'

function deps(over: Partial<RadminDeps> = {}): RadminDeps {
  return {
    findExe: async () => 'C:\\Program Files\\Radmin VPN\\RadminVPN.exe',
    adapterIp: async () => null,
    runJoin: async () => 0,
    waitMs: 20,
    pollMs: 5,
    ...over,
  }
}

describe('firstRadminIp', () => {
  it('returns the first non-internal 26.x IPv4 and ignores everything else', () => {
    const ifaces = {
      eth0: [{ family: 'IPv4', address: '192.168.1.5', internal: false }],
      radmin: [
        { family: 'IPv4', address: '26.12.0.1', internal: false },
        { family: 'IPv4', address: '26.99.0.9', internal: false },
      ],
      lo: [{ family: 'IPv4', address: '26.0.0.1', internal: true }],
    }
    expect(firstRadminIp(ifaces)).toBe('26.12.0.1')
  })

  it('is null when there is no Radmin adapter', () => {
    expect(firstRadminIp({ eth0: [{ family: 'IPv4', address: '10.0.0.2', internal: false }] })).toBeNull()
    expect(firstRadminIp({})).toBeNull()
  })
})

describe('joinRadminVlanWith — honest outcomes only', () => {
  it('fails honestly when Radmin VPN is not installed', async () => {
    const runJoin = vi.fn(async () => 0)
    const res = await joinRadminVlanWith(deps({ findExe: async () => null, runJoin }), 'gMatch Official VLAN', 'GMATCHVLAN')
    expect(res.status).toBe('failed')
    expect(res.reason).toMatch(/not installed/i)
    expect(runJoin).not.toHaveBeenCalled()
  })

  it('reports joined ONLY when the process exits 0 AND a 26.x adapter appears', async () => {
    const res = await joinRadminVlanWith(
      deps({ runJoin: async () => 0, adapterIp: async () => '26.42.0.7' }),
      'gMatch Official VLAN',
      'GMATCHVLAN',
    )
    expect(res).toEqual({ status: 'joined', ip: '26.42.0.7' })
  })

  it('does not claim joined when the process exits non-zero, even if an adapter exists', async () => {
    const res = await joinRadminVlanWith(
      deps({ runJoin: async () => 1, adapterIp: async () => '26.42.0.7' }),
      'name',
      'pw',
    )
    expect(res.status).toBe('failed')
    expect(res.reason).toMatch(/exited with code 1/)
  })

  it('does not claim joined when the process could not be run', async () => {
    const res = await joinRadminVlanWith(deps({ runJoin: async () => null }), 'name', 'pw')
    expect(res.status).toBe('failed')
    expect(res.reason).toMatch(/could not run/i)
  })

  it('does not claim joined when no 26.x adapter appears within the bounded wait', async () => {
    const res = await joinRadminVlanWith(
      deps({ runJoin: async () => 0, adapterIp: async () => null, waitMs: 20, pollMs: 5 }),
      'name',
      'pw',
    )
    expect(res.status).toBe('failed')
    expect(res.reason).toMatch(/no 26\.x/i)
  })

  it('passes the exact Radmin command arguments through to runJoin', async () => {
    const runJoin = vi.fn(async () => 0)
    await joinRadminVlanWith(deps({ runJoin, adapterIp: async () => '26.1.2.3' }), 'gMatch Official VLAN', 'GMATCHVLAN')
    expect(runJoin).toHaveBeenCalledWith(
      'C:\\Program Files\\Radmin VPN\\RadminVPN.exe',
      'gMatch Official VLAN',
      'GMATCHVLAN',
    )
  })
})