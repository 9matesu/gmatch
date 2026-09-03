const UNITS = ['k', 'M', 'B', 'T', 'Qa', 'Qi']

/** Compact monospace-friendly number formatting for GP displays. */
export function formatNum(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return n < 100 && n % 1 !== 0 ? n.toFixed(1) : String(Math.floor(n))
  let v = n
  let u = -1
  while (v >= 1000 && u < UNITS.length - 1) {
    v /= 1000
    u++
  }
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)}${UNITS[u]}`
}
