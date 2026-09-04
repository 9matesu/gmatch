// Aggregate eslint JSON warnings by top-level src dir. Usage: node tools/lint-summary.cjs < eslint.json
let s = ''
process.stdin.on('data', (d) => (s += d))
process.stdin.on('end', () => {
  const r = JSON.parse(s)
  const by = {}
  for (const f of r) {
    for (const m of f.messages) {
      const rel = f.filePath.split(/[\\/]+src[\\/]+/)[1] || '?'
      const dir = rel.split(/[\\/]/)[0]
      by[dir] = (by[dir] || 0) + 1
    }
  }
  console.log(JSON.stringify(by, null, 1))
})
