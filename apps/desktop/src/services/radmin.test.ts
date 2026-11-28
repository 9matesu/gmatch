import { describe, expect, it, vi } from 'vitest'
import { firstRadminIp, joinRadminVlanWith, radminExeCandidates, type RadminDeps } from './radmin'

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
  it('returns the first 26.x IPv4 and ignores everything else', () => {
    const ifaces = {
      eth0: [{ family: 'IPv4', address: '192.168.1.5', internal: false }],
      radmin: [
        { family: 'IPv4', address: '26.12.0.1', internal: false },
        { family: 'IPv4', address: '26.99.0.9', internal: false },
      ],
    }
    expect(firstRadminIp(ifaces)).toBe('26.12.0.1')
  })

  it('does not miss an internal-flagged 26.x adapter (Windows virtual TAP)', () => {
    // 26/8 is Radmin's range alone, so the internal flag cannot disqualify it.
    expect(firstRadminIp({ lo: [{ family: 4, address: '26.26.113.34', internal: true }] })).toBe('26.26.113.34')
    expect(firstRadminIp({ lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] })).toBeNull()
  })

  it('is null when there is no Radmin adapter', () => {
    expect(firstRadminIp({ eth0: [{ family: 'IPv4', address: '10.0.0.2', internal: false }] })).toBeNull()
    expect(firstRadminIp({})).toBeNull()
  })
})

describe('radminExeCandidates', () => {
  it('checks both exe names in every standard install dir (Radmin 2.x is Radmin.exe)', () => {
    const paths = radminExeCandidates({
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    })
    expect(paths).toContain('C:\\Program Files (x86)\\Radmin VPN\\Radmin.exe')
    expect(paths).toContain('C:\\Program Files\\Radmin VPN\\RadminVPN.exe')
    expect(paths).toContain('C:\\Users\\me\\AppData\\Local\\Programs\\Radmin VPN\\Radmin.exe')
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