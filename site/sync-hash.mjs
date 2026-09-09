// Run from site/: node sync-hash.mjs
// Rewrites the <pre id="sha256"> and version markers in index.html/en.html
// from release.json. Idempotent; the source of truth is release.json (which
// build-release.mjs derives FROM THE FILE).
import { readFileSync, writeFileSync } from 'node:fs'

const rel = JSON.parse(readFileSync('release.json', 'utf8'))
let touched = 0
for (const file of ['index.html', 'en.html']) {
  let html = readFileSync(file, 'utf8')
  const before = html
  // sha block
  html = html.replace(/<pre id="sha256">[0-9a-f]{64}<\/pre>/, `<pre id="sha256">${rel.sha256}</pre>`)
  // version marker + filename mentions
  html = html.replace(/(<strong id="version">)[^<]+(<\/strong>)/, `$1${rel.version}$2`)
  html = html.replace(/goonMatch-Grid-\d+\.\d+\.\d+-portable\.exe/g, rel.file)
  // Publish link: prefer the canonical GitHub Release URL (Pages artifact
  // stays binary-free); local dev without downloadUrl keeps releases/<file>.
  const want = rel.downloadUrl || `releases/${rel.file}`
  html = html.replace(/href="(?:releases\/[^"]+|https:\/\/github\.com\/9matesu\/goongrid\/releases\/download\/[^"]+)-portable\.exe"/g, `href="${want}"`)
  if (html !== before) {
    writeFileSync(file, html)
    touched++
  }
}
console.log(`sync-hash: ${touched} file(s) updated -> ${rel.file} ${rel.sha256.slice(0, 12)}…`)
