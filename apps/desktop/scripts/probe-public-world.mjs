// Reachability check for the built-in public node (Servers → gmatch Node).
// Usage: node scripts/probe-public-world.mjs [baseUrl]
//
// This is a liveness probe, not a simulation of the in-app join: it asserts the
// node answers health with a ready database and publishes its directory. The
// join path itself is switchClientWorld (src/utils/server-switch.ts), covered by
// unit tests; a GUI join is not automated here.
const base = (process.argv[2] || 'https://gmatch.fly.dev').replace(/\/+$/, '')
const timeout = AbortSignal.timeout(10000)

const health = await fetch(`${base}/api/health`, { signal: timeout })
if (!health.ok) {
  console.error(`FAIL health: HTTP ${health.status}`)
  process.exit(1)
}
const h = await health.json()
if (h?.status !== 'ok' || h?.db_ready !== true) {
  console.error(`FAIL health payload: ${JSON.stringify(h)}`)
  process.exit(1)
}

const dir = await fetch(`${base}/api/servers`, { signal: timeout })
if (!dir.ok) {
  console.error(`FAIL directory: HTTP ${dir.status}`)
  process.exit(1)
}
const d = await dir.json()
if (!Array.isArray(d?.servers)) {
  console.error(`FAIL directory payload: ${JSON.stringify(d)}`)
  process.exit(1)
}

console.log(`OK ${base}`)
console.log(`   health: ok, db_ready, services=${JSON.stringify(h.services ?? null)} mode=${h.mode ?? '?'}`)
console.log(`   directory rows: ${d.servers.length}`)
