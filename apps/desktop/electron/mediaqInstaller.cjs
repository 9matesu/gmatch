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
 * main) and is CANCELLABLE through an AbortSignal: the uv download aborts, and
 * the tar/uv child processes are killed. The decision logic (`uvAssetName`,
 * `installPlan`) is pure and exported so it is unit-tested without a network.
 *
 * Progress events are `{ phase, message, percent? }`: `percent` is a number for
 * the determinate phases (the uv download, sized by Content-Length) and ABSENT
 * for indeterminate ones (the uv install), which the UI renders as a spinner.
 */

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const UV_BASE = 'https://github.com/astral-sh/uv/releases/latest/download'
const MEDIAQ_SPEC = 'mediaq'
const PYTHON_SPEC = '3.12'

function abortError() {
  const e = new Error('cancelled')
  e.name = 'AbortError'
  return e
}

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

/** Spawn, capture output, resolve {stdout, stderr}; kill on abort. */
function run(cmd, args, opts = {}) {
  const { signal, onData } = opts
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const onAbort = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already dead */
      }
    }
    if (signal) {
      if (signal.aborted) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        return reject(abortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    child.stdout.on('data', (d) => {
      stdout += d
      if (onData) onData(String(d))
    })
    child.stderr.on('data', (d) => {
      stderr += d
      if (onData) onData(String(d))
    })
    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('exit', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      if (signal && signal.aborted) return reject(abortError())
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`exit ${code}: ${stderr.slice(-500)}`))
    })
  })
}

/** Spawn and stream stdout+stderr lines to `onLine`; resolve on exit 0; kill on abort. */
function runStreaming(cmd, args, onLine, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let tail = ''
    const onAbort = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already dead */
      }
    }
    if (signal) {
      if (signal.aborted) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        return reject(abortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    const onData = (d) => {
      const line = String(d).trim()
      if (!line) return
      tail = (tail + '\n' + line).slice(-800)
      if (onLine) onLine(line)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('exit', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      if (signal && signal.aborted) return reject(abortError())
      if (code === 0) resolve()
      else reject(new Error(`exit ${code}: ${tail}`))
    })
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
async function ensureUv({ userData, platform = process.platform, arch = process.arch, onProgress, signal }) {
  const existing = uvPath(userData)
  if (fs.existsSync(existing)) return existing
  const asset = uvAssetName(platform, arch)
  if (!asset) throw new Error('unsupported platform for uv')
  const dir = path.join(userData, 'bin')
  fs.mkdirSync(dir, { recursive: true })
  const url = `${UV_BASE}/${asset}`
  const archive = path.join(dir, asset)
  onProgress?.({ phase: 'download-uv', message: 'Downloading uv (Python manager)…' })
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`uv download HTTP ${res.status}`)
  // Stream to a temp file so the bar tracks real bytes (Content-Length).
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body ? res.body.getReader() : null
  const chunks = []
  if (reader) {
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (signal?.aborted) throw abortError()
      chunks.push(Buffer.from(value))
      received += value.length
      if (total > 0) {
        onProgress?.({
          phase: 'download-uv',
          percent: Math.min(50, Math.round((50 * received) / total)),
          message: `Downloading uv… ${Math.round((100 * received) / total)}%`,
        })
      }
    }
    fs.writeFileSync(archive, Buffer.concat(chunks))
  } else {
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
  }
  onProgress?.({ phase: 'extract-uv', percent: 55, message: 'Extracting uv…' })
  // bsdtar (Windows) reads zip with -xf; GNU tar (mac/linux) needs -xzf for tar.gz.
  const tarArgs = platform === 'win32' ? ['-xf', archive, '-C', dir] : ['-xzf', archive, '-C', dir]
  await run('tar', tarArgs, { signal })
  if (!fs.existsSync(existing)) throw new Error('uv binary missing after extract')
  try {
    fs.chmodSync(existing, 0o755)
  } catch {
    /* best effort */
  }
  try {
    fs.unlinkSync(archive)
  } catch {
    /* best effort */
  }
  return existing
}

/** The mediaq executable path (from `uv tool dir --bin`), or null. */
async function resolveMediaqBin(uv, signal) {
  const { stdout } = await run(uv, ['tool', 'dir', '--bin'], { signal })
  const dir = stdout.trim()
  if (!dir) return null
  const name = process.platform === 'win32' ? 'mediaq.exe' : 'mediaq'
  const bin = path.join(dir, name)
  return fs.existsSync(bin) ? bin : null
}

/** Install mediaq (and a managed Python 3.12) via uv. */
async function installMediaq({ uv, onProgress, signal }) {
  onProgress?.({ phase: 'install-mediaq', message: 'Installing mediaq (first run downloads Python 3.12)…' })
  await runStreaming(uv, ['tool', 'install', '--python', PYTHON_SPEC, MEDIAQ_SPEC], (line) => onProgress?.({ phase: 'install-mediaq', message: line }), signal)
  return resolveMediaqBin(uv, signal)
}

/**
 * Full one-shot install: uv (if needed) then mediaq. Cancellable through
 * `signal`. Returns the mediaq bin.
 * @param {{userData:string, onProgress?:(p:{phase:string,message:string,percent?:number})=>void, signal?:AbortSignal}} deps
 */
async function installMediaqSuite({ userData, onProgress, signal }) {
  const uv = await ensureUv({ userData, onProgress, signal })
  const bin = await installMediaq({ uv, onProgress, signal })
  if (!bin) throw new Error('mediaq installed but its executable was not found')
  onProgress?.({ phase: 'done', percent: 100, message: 'mediaq is ready' })
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
  _internal: { run, runStreaming, abortError },
}