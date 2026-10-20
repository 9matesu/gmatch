// node startupMetrics.test.cjs — exits 1 on failure (plain-node CJS, same
// style as imageCache.test.cjs). Pins the three properties the report depends
// on: peaks are the MAXIMUM per process (not the last sample), marks are
// relative to boot, and a failing sampler never ends the measurement.
const assert = require('assert')
const { createStartupMetrics } = require('./startupMetrics.cjs')

async function main() {
  // 1. Peak per process type is the maximum over the window, and the summary
  //    is ordered hottest-first. A last-sample reading would be wrong here.
  let n = 0
  const lines = []
  const metrics = createStartupMetrics({
    sample: () => {
      n += 1
      return [
        // Rising: its peak IS the last sample.
        { type: 'Browser', pid: 7, cpu: { percentCPUUsage: n * 10 }, memory: { workingSetSize: 10 * 1048576 } },
        // Spikes once, then settles: its peak is the FIRST sample, so a
        // last-sample implementation would report 5% instead of 95%.
        { type: 'GPU', pid: 9, cpu: { percentCPUUsage: n === 1 ? 95 : 5 }, memory: { workingSetSize: 2 * 1048576 } },
      ]
    },
    log: (line) => lines.push(line),
    sampleMs: 10,
    durationMs: 0, // no auto-finish; the test owns the clock
  })

  metrics.begin()
  await new Promise((resolve) => setTimeout(resolve, 55))
  metrics.mark('window:created')
  metrics.mark('renderer:first-paint')
  const summary = metrics.finish('test')

  assert.ok(summary, 'finish returns a summary')
  assert.ok(summary.samples >= 3, `expected several samples, got ${summary.samples}`)
  assert.strictEqual(summary.peaks[0].type, 'GPU', 'hottest process first')
  assert.strictEqual(summary.peaks[0].pct, 95, 'GPU peak is its maximum, not its last sample')
  const browser = summary.peaks.find((p) => p.type === 'Browser')
  assert.strictEqual(browser.pct, n * 10, 'rising process reports its latest sample as the peak')
  assert.deepStrictEqual(
    summary.marks.map((m) => m.label),
    ['window:created', 'renderer:first-paint'],
  )
  assert.ok(summary.marks.every((m) => Number.isFinite(m.at) && m.at >= 0), 'marks carry ms offsets')
  assert.ok(lines.some((l) => l.includes('boot: phases')), 'phases are logged')
  assert.ok(lines.some((l) => l.startsWith('boot: peak Browser')), 'per-process peaks are logged')

  // 2. finish() is idempotent: a second call cannot log or persist twice.
  const before = lines.length
  assert.strictEqual(metrics.finish('again'), null)
  assert.strictEqual(lines.length, before)

  // 3. A sampler that throws is a skipped sample, not a crash.
  const quiet = []
  const broken = createStartupMetrics({
    sample: () => {
      throw new Error('metrics unavailable')
    },
    log: (line) => quiet.push(line),
    sampleMs: 10,
    durationMs: 0,
  })
  broken.begin()
  await new Promise((resolve) => setTimeout(resolve, 25))
  const brokenSummary = broken.finish('broken')
  assert.ok(brokenSummary, 'still produces a summary')
  assert.strictEqual(brokenSummary.peaks.length, 0, 'no invented peaks')

  // 4. A mark before begin() is dropped rather than producing a negative time.
  const early = createStartupMetrics({ sample: () => [], sampleMs: 10, durationMs: 0 })
  early.mark('too-early')
  early.begin()
  const earlySummary = early.finish('early')
  assert.deepStrictEqual(earlySummary.marks, [], 'pre-boot marks are ignored')

  console.log('startupMetrics tests OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
