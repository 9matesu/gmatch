'use strict'

/**
 * mediaq dependency installer.
 *
 * mediaq is a Python 3.12 tool. We do NOT bundle Python. Instead we use `uv`
 * (Astral's single-binary Python manager): download the uv release binary for
 * this platform, then `uv tool install --python 3.12 mediaq`, which pulls a
 * managed CPython 3.12 and mediaq's deps into an isolated tool env.
 *
 * Everything that touches the network or spawns a process is here (Electron
 * main). The decision logic (`uvAssetName`, `installPlan`) is pure and exported
 * so it is unit-tested without a network.
 */

const { spawn, execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const UV_BASE = 'https://github.com/astral-sh/uv/releases/latest/download'
const MEDIAQ_SPEC = 'mediaq'
const PYTHON_SPEC = '3.12'

/** The uv release asset for a platform/arch, or null when unsupported. */
function uvAssetName(platform, arch) {
  const a = arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (platform === 'win32') return `uv-${a}-pc-windows-msvc.zip`
  if (platform === 'darwin') return `uv-${a}-apple-darwin.tar.gz`
  if (platform === 'linux') return `uv-${a}-unknown-linux-gnu.tar.gz`
  return null
}

/** The binary name inside the extracted archive. */
function uvBinName(platform) {
  return platform === 'win32' ? 'uv.exe' : 'uv'
}

/**
 * Pure decision: given the platform and what is already present, what is the
 * next install step? Exported + tested.
 * @param {{platform:string, arch:string, hasUv:boolean, hasMediaq:boolean}} s
 * @returns {{step:'unsupported'|'install-uv'|'install-mediaq'|'ready', asset:string|null}}
 */
function installPlan({ platform, arch, hasUv, hasMediaq }) {
  const asset = uvAssetName(platform, arch)
  if (!asset) return { step: 'unsupported', asset: null }
  if (!hasUv) return { step: 'install-uv', asset }
  if (!hasMediaq) return { step: 'install-mediaq', asset }
  return { step: 'ready', asset }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

/** Spawn and stream stdout+stderr lines to `onLine`; resolve on exit 0. */
function runStreaming(cmd, args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    let tail = ''
    const onData = (d) => {
      const s = String(d).trim()
      if (!s) return
      tail = (tail + '\n' + s).slice(-800)
      if (onLine) onLine(s)
    }
    p.stdout.on('data', onData)
    p.stderr.on('data', onData)
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}: ${tail}`))))
  })
}

/** Where uv lives for this install (userData/bin). */
function uvPath(userData) {
  return path.join(userData, 'bin', uvBinName(process.platform))
}

/** True when uv is already present and executable. */
function hasUv(userData) {
  try {
    return fs.existsSync(uvPath(userData))
  } catch {
    return false
  }
}

/** Download + extract the uv release binary. Returns its path. */
async function ensureUv({ userData, platform = process.platform, arch = process.arch, onProgress }) {
  const existing = uvPath(userData)
  if (fs.existsSync(existing)) return existing
  const asset = uvAssetName(platform, arch)
  if (!asset) throw new Error('unsupported platform for uv')
  const dir = path.join(userData, 'bin')
  fs.mkdirSync(dir, { recursive: true })
  const url = `${UV_BASE}/${asset}`
  const archive = path.join(dir, asset)
  onProgress?.({ phase: 'download-uv', message: 'Downloading uv (Python manager)…' })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`uv download HTTP ${res.status}`)
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
  onProgress?.({ phase: 'extract-uv', message: 'Extracting uv…' })
  // bsdtar (Windows) reads zip with -xf; GNU tar (mac/linux) needs -xzf for tar.gz.
  const tarArgs = platform === 'win32' ? ['-xf', archive, '-C', dir] : ['-xzf', archive, '-C', dir]
  await run('tar', tarArgs)
  if (!fs.existsSync(existing)) throw new Error('uv binary missing after extract')
  try { fs.chmodSync(existing, 0o755) } catch { /* best effort */ }
  try { fs.unlinkSync(archive) } catch { /* best effort */ }
  return existing
}

/** The mediaq executable path (from `uv tool dir --bin`), or null. */
async function resolveMediaqBin(uv) {
  const { stdout } = await run(uv, ['tool', 'dir', '--bin'])
  const dir = stdout.trim()
  if (!dir) return null
  const name = process.platform === 'win32' ? 'mediaq.exe' : 'mediaq'
  const bin = path.join(dir, name)
  return fs.existsSync(bin) ? bin : null
}

/** Install mediaq (and a managed Python 3.12) via uv. */
async function installMediaq({ uv, onProgress }) {
  onProgress?.({ phase: 'install-mediaq', message: 'Installing mediaq (first run downloads Python 3.12)…' })
  await runStreaming(uv, ['tool', 'install', '--python', PYTHON_SPEC, MEDIAQ_SPEC], (line) =>
    onProgress?.({ phase: 'install-mediaq', message: line }),
  )
  return resolveMediaqBin(uv)
}

/**
 * Full one-shot install: uv (if needed) then mediaq. Returns the mediaq bin.
 * @param {{userData:string, onProgress?:(p:{phase:string,message:string})=>void}} deps
 */
async function installMediaqSuite({ userData, onProgress }) {
  const uv = await ensureUv({ userData, onProgress })
  const bin = await installMediaq({ uv, onProgress })
  if (!bin) throw new Error('mediaq installed but its executable was not found')
  onProgress?.({ phase: 'done', message: 'mediaq is ready' })
  return { uv, bin }
}

/** Current status without changing anything. */
async function mediaqStatus({ userData }) {
  const uv = uvPath(userData)
  const hasUvBin = hasUv(userData)
  let bin = null
  if (hasUvBin) {
    try {
      bin = await resolveMediaqBin(uv)
    } catch {
      bin = null
    }
  }
  return { installed: Boolean(bin), hasUv: hasUvBin, bin }
}

module.exports = {
  uvAssetName,
  uvBinName,
  installPlan,
  uvPath,
  hasUv,
  ensureUv,
  resolveMediaqBin,
  installMediaq,
  installMediaqSuite,
  mediaqStatus,
  // exported for tests
  _internal: { run, runStreaming },
}