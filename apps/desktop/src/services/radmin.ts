/**
 * Radmin VPN auto-join (connectivity helper).
 *
 * Two peers on the same Radmin VPN share one virtual LAN (26.0.0.0/8), so a
 * Radmin host candidate is a real direct path (see utils/ice-hygiene.ts). This
 * helper automates the join so the player does not have to drive Radmin's own
 * UI: it locates `RadminVPN.exe`, runs `/joinnetwork <name> <password>` with a
 * hidden window and a bounded wait, and only reports `joined` when the process
 * exited 0 AND a 26.x adapter actually appeared. Anything else is an honest
 * `failed` with a reason — never a fabricated success.
 *
 * The renderer is sandboxed (electron webPreferences: nodeIntegration:false,
 * sandbox:true), so the Node builtins are loaded lazily through a
 * `@vite-ignore` dynamic import: in a node context (tests, dev tools) they
 * resolve; in the browser/sandbox the import rejects and every function
 * degrades to a null / `failed` result instead of throwing. A packaged build
 * that wants this button to really spawn the process needs a preload/main IPC
 * handler in front of these seams (out of this module's scope).
 */

import { isRadminVpnAddress } from '../utils/ice-hygiene'

export interface RadminJoinResult {
  status: 'joined' | 'failed'
  /** The 26.x address of the adapter that appeared (only on `joined`). */
  ip?: string
  /** Why it failed (only on `failed`). */
  reason?: string
}

/** Injected seams so the join logic is unit-testable without real processes. */
export interface RadminDeps {
  /** Absolute path to RadminVPN.exe, or null when it is not installed. */
  findExe(): Promise<string | null>
  /** First 26.x IPv4 from the OS network interfaces, or null. */
  adapterIp(): Promise<string | null>
  /** Run the join. Resolves the exit code, or null when it could not run. */
  runJoin(exe: string, name: string, password: string): Promise<number | null>
  /** Bounded wait for the adapter to appear after a clean exit (ms). */
  waitMs?: number
  /** Poll interval while waiting for the adapter (ms). */
  pollMs?: number
}

interface OsInterface { family: string | number; address: string; internal: boolean }

/**
 * First 26.x IPv4 from an `os.networkInterfaces()`-shaped map. The 26/8 range
 * is Radmin's alone, so an `internal` flag cannot disqualify a real adapter —
 * Windows marks some virtual TAP adapters that way. Pure for testing.
 */
export function firstRadminIp(
  ifaces: Record<string, OsInterface[] | undefined>,
): string | null {
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      if (!ni) continue
      const v4 = ni.family === 'IPv4' || ni.family === 4
      if (v4 && isRadminVpnAddress(ni.address)) return ni.address
    }
  }
  return null
}

/** Load a Node builtin lazily; null in a sandbox/browser (import rejects). */
async function loadNodeModule(name: string): Promise<any | null> {
  try {
    const spec = 'node:' + name
    const mod: any = await import(/* @vite-ignore */ spec)
    return mod?.default ?? mod ?? null
  } catch {
    return null
  }
}

/**
 * Every standard install location × both executable names. Radmin VPN 2.x
 * installs `Radmin.exe` (not `RadminVPN.exe`) under Program Files (x86), so
 * checking only the old name reported "not installed" on a machine that was
 * already connected to a 26.x adapter. Pure so the list is testable.
 */
export function radminExeCandidates(env: Record<string, string | undefined> = {}): string[] {
  const pf = env.ProgramFiles || 'C:\\Program Files'
  const pfx = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const local = env.LOCALAPPDATA || ''
  const dirs = [`${pf}\\Radmin VPN`, `${pfx}\\Radmin VPN`]
  if (local) dirs.push(`${local}\\Programs\\Radmin VPN`)
  return dirs.flatMap((dir) => [`${dir}\\RadminVPN.exe`, `${dir}\\Radmin.exe`])
}

async function findRadminVpnDefault(): Promise<string | null> {
  const fs = await loadNodeModule('fs')
  if (!fs?.existsSync) return null
  const env = (globalThis as any)?.process?.env ?? {}
  for (const candidate of radminExeCandidates(env)) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch { /* keep looking */ }
  }
  return null
}

async function radminAdapterIpDefault(): Promise<string | null> {
  const os = await loadNodeModule('os')
  if (!os?.networkInterfaces) return null
  try {
    return firstRadminIp(os.networkInterfaces() as Record<string, OsInterface[]>)
  } catch {
    return null
  }
}

const JOIN_TIMEOUT_MS = 15_000

async function runJoinDefault(exe: string, name: string, password: string): Promise<number | null> {
  const cp = await loadNodeModule('child_process')
  if (!cp?.spawn) return null
  return new Promise<number | null>((resolve) => {
    let settled = false
    let child: any = null
    const settle = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(code)
    }
    const timer = setTimeout(() => {
      try { child?.kill() } catch { /* already gone */ }
      settle(null)
    }, JOIN_TIMEOUT_MS)
    try {
      child = cp.spawn(exe, ['/joinnetwork', name, password], { windowsHide: true, stdio: 'ignore' })
    } catch {
      settle(null)
      return
    }
    child.on('error', () => settle(null))
    child.on('exit', (code: number | null) => settle(code))
  })
}

const defaultDeps: RadminDeps = {
  findExe: findRadminVpnDefault,
  adapterIp: radminAdapterIpDefault,
  runJoin: runJoinDefault,
}

/**
 * The join core. `joined` requires a clean exit AND a 26.x adapter within the
 * bounded wait; every other path is `failed` with the real reason.
 */
export async function joinRadminVlanWith(
  deps: RadminDeps,
  name: string,
  password: string,
): Promise<RadminJoinResult> {
  const exe = await deps.findExe()
  if (!exe) return { status: 'failed', reason: 'Radmin VPN is not installed' }

  const code = await deps.runJoin(exe, name, password)
  if (code === null) return { status: 'failed', reason: 'Could not run Radmin VPN' }
  if (code !== 0) return { status: 'failed', reason: `Radmin VPN exited with code ${code}` }

  const waitMs = deps.waitMs ?? 8000
  const pollMs = deps.pollMs ?? 500
  const deadline = Date.now() + waitMs
  for (;;) {
    const ip = await deps.adapterIp()
    if (ip) return { status: 'joined', ip }
    if (Date.now() >= deadline) return { status: 'failed', reason: 'No 26.x Radmin adapter appeared' }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

type RadminStatus = { installed: boolean; ip: string | null; globalIpv6?: string | null }

function bridge(): { radminStatus?: () => Promise<RadminStatus>; radminJoin?: (name: string, password: string) => Promise<RadminJoinResult> } | undefined {
  return (globalThis as { window?: { gmatch?: { radminStatus?: () => Promise<RadminStatus>; radminJoin?: (name: string, password: string) => Promise<RadminJoinResult> } } }).window?.gmatch
}

/** Locate the Radmin executable in the standard install paths, or null. */
export async function findRadminVpn(): Promise<string | null> {
  const b = bridge()
  if (b?.radminStatus) {
    try { return (await b.radminStatus()).installed ? 'bridge' : null } catch { /* fall through */ }
  }
  return defaultDeps.findExe()
}

/** First 26.x.x.x IPv4 from the OS network interfaces, or null. */
export async function radminAdapterIp(): Promise<string | null> {
  const b = bridge()
  if (b?.radminStatus) {
    try { return (await b.radminStatus()).ip } catch { /* fall through */ }
  }
  return defaultDeps.adapterIp()
}

/** A global IPv6 (2000::/3) address on this machine, or null. The main process
 *  reports it through the bridge; a browser build cannot see OS interfaces. */
export async function globalIpv6Address(): Promise<string | null> {
  const b = bridge()
  if (b?.radminStatus) {
    try { return (await b.radminStatus()).globalIpv6 ?? null } catch { /* fall through */ }
  }
  return null
}

/** Join the Radmin VLAN, reporting only a real outcome. */
export async function joinRadminVlan(name: string, password: string): Promise<RadminJoinResult> {
  const b = bridge()
  if (b?.radminJoin) return b.radminJoin(name, password)
  return joinRadminVlanWith(defaultDeps, name, password)
}