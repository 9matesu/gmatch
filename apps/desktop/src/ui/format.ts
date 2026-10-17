const UNITS = ['k', 'M', 'B', 'T', 'Qa', 'Qi']

/**
 * Whole-number formatting for currency/wallet displays, with thousands
 * separators. Guards non-finite input: `Math.floor(undefined).toLocaleString()`
 * is NaN, and `NaN.toLocaleString()` renders the literal string "NaN" in the
 * top bar and the Store whenever the server roster omits the caller's row.
 */
export function formatCount(n: number | null | undefined): string {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return '0'
  return Math.floor(v).toLocaleString()
}

/** Compact tabular-friendly number formatting for in-game point displays. */
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
