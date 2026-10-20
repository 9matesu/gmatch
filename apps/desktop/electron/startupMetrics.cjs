// Startup diagnostics: which process burns CPU at launch, for how long, and
// which boot phase it lands in.
//
// Why this exists: a "60% CPU at startup, then it stops" report cannot be
// attributed from a Task Manager screenshot. A grouped app row sums every
// Chromium child process, and a lifetime-average hides a spike. This module
// measures per process, per window, and lines the samples up with boot marks.
//
// Bounded on purpose:
//  - one 20 s window, one sample every 500 ms (40 samples, a few KB of RAM);
//  - `app.getAppMetrics().cpu.percentCPUUsage` is CPU used BETWEEN calls, so a
//    500 ms cadence measures a 500 ms window instead of an average since the
//    process started (which is exactly what makes a spike invisible);
//  - nothing is written until the window closes, so the measurement adds no
//    I/O to the phase being measured;
//  - every entry point is guarded: diagnostics must never take boot down.
//
// It cannot see work that happens BEFORE this process exists (the portable
// exe extracts itself to %TEMP% and Defender scans the files first), so
// `process.uptime()` at ready is logged separately: a large value there means
// the time went to the launch path, not to app code.
const fs = require('node:fs')
const path = require('node:path')

const SAMPLE_MS = 500
const DURATION_MS = 20_000

/** Features worth naming; anything else in the status object is noise here. */
const GPU_FEATURES = ['gpu_compositing', 'rasterization', 'webgl', 'webgl2', 'video_decode', '2d_canvas']

/**
 * Build a sampler. `sample()` is injected (app.getAppMetrics in production,
 * a fixture in tests) so this file never has to import Electron.
 */
function createStartupMetrics({
  sample,
  log = () => {},
  now = Date.now,
  durationMs = DURATION_MS,
  sampleMs = SAMPLE_MS,
  persist = null,
} = {}) {
  let startedAt = 0
  let marks = []
  let peaks = new Map()
  let samples = 0
  let timer = null
  let autoFinish = null
  let done = false

  function record() {
    let list
    try {
      list = sample() || []
    } catch {
      return // a metrics hiccup must not end the run
    }
    samples += 1
    for (const m of list) {
      if (!m || typeof m !== 'object') continue
      const type = String(m.type || 'unknown')
      const pct = Number(m?.cpu?.percentCPUUsage)
      if (!Number.isFinite(pct)) continue
      const prev = peaks.get(type)
      if (!prev || pct > prev.pct) {
        peaks.set(type, {
          pct: Math.round(pct * 10) / 10,
          pid: Number(m.pid) || null,
          memoryMB: Math.round((Number(m?.memory?.workingSetSize) || 0) / 1048576),
        })
      }
    }
  }

  function peakList() {
    return [...peaks.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.pct - a.pct)
  }

  function begin() {
    if (startedAt || done) return startedAt
    startedAt = now()
    marks = []
    peaks = new Map()
    samples = 0
    record()
    timer = setInterval(record, sampleMs)
    if (typeof timer.unref === 'function') timer.unref()
    if (durationMs > 0) {
      autoFinish = setTimeout(() => finish('window elapsed'), durationMs)
      if (typeof autoFinish.unref === 'function') autoFinish.unref()
    }
    return startedAt
  }

  /** A boot phase or a renderer milestone. Ignored after the window closes. */
  function mark(label) {
    if (!startedAt || done) return
    const text = String(label || '').slice(0, 64)
    if (!text) return
    marks.push({ label: text, at: Math.max(0, now() - startedAt) })
  }

  function finish(reason = 'window elapsed') {
    if (!startedAt || done) return null
    done = true
    if (timer) clearInterval(timer)
    if (autoFinish) clearTimeout(autoFinish)
    timer = null
    autoFinish = null

    const summary = {
      at: new Date().toISOString(),
      reason: String(reason),
      windowMs: now() - startedAt,
      samples,
      peaks: peakList(),
      marks: marks.slice(),
    }

    try {
      log(`boot: metrics ${summary.reason} after ${(summary.windowMs / 1000).toFixed(1)}s (${samples} samples)`)
      for (const p of summary.peaks) {
        log(`boot: peak ${p.type} ${p.pct}% pid=${p.pid ?? '?'} ${p.memoryMB}MB`)
      }
      if (summary.marks.length > 0) {
        log(`boot: phases ${summary.marks.map((m) => `${m.label}@${m.at}ms`).join(' ')}`)
      } else {
        log('boot: phases (no marks recorded)')
      }
    } catch {
      /* logging is best-effort */
    }

    if (persist) {
      try {
        persist(summary)
      } catch {
        /* a full or locked disk must not fail boot */
      }
    }
    return summary
  }

  return { begin, mark, finish, _peaks: peakList }
}

/** Cheap facts about the launch path, then the GPU status (async, capped). */
async function logEnvironment(app, log = () => {}) {
  const lines = []
  try {
    lines.push(`boot: exec ${process.execPath} (packaged=${app.isPackaged}, resources=${process.resourcesPath})`)
    lines.push(
      `boot: ready after ${Math.round(process.uptime() * 1000)}ms ` +
        `(electron=${process.versions.electron} chrome=${process.versions.chrome})`,
    )
  } catch {
    /* older/odd host */
  }
  try {
    const status = app.getGPUFeatureStatus() || {}
    lines.push(
      `boot: gpu features ${GPU_FEATURES.map((k) => `${k}=${status[k] ?? '?'}`).join(' ')}`,
    )
  } catch {
    /* no gpu info */
  }
  try {
    const info = await Promise.race([
      app.getGPUInfo('complete'),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ])
    const devices = Array.isArray(info?.gpuDevice) ? info.gpuDevice : []
    if (devices.length > 0) {
      const named = devices.map((d) => {
        const vendor = Number(d?.vendorId)
        const device = Number(d?.deviceId)
        const ids = `${Number.isFinite(vendor) ? `0x${vendor.toString(16)}` : '?'}:${
          Number.isFinite(device) ? `0x${device.toString(16)}` : '?'
        }`
        return `${d?.active ? '*' : ''}${ids}`
      })
      lines.push(`boot: gpu device ${named.join(' ')} (* = active)`)
    }
  } catch {
    /* driver may refuse; absence is itself informative */
  }
  for (const line of lines) {
    try {
      log(line)
    } catch {
      /* best-effort */
    }
  }
  return lines
}

/** Write a JSON summary next to main.log (last run only, overwritten). */
function filePersister(userDataPath) {
  return (summary) => {
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.writeFileSync(path.join(userDataPath, 'startup-metrics.json'), JSON.stringify(summary, null, 2))
  }
}

module.exports = { createStartupMetrics, logEnvironment, filePersister, SAMPLE_MS, DURATION_MS }
