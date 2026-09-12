// Run from site/: node sync-hash.mjs
// Rewrites the <pre id="sha256"> and version markers in index.html
// from release.json. Idempotent; the source of truth is release.json (which
// build-release.mjs derives FROM THE FILE).
import { readFileSync, writeFileSync } from 'node:fs'

const rel = JSON.parse(readFileSync('release.json', 'utf8'))
let touched = 0
for (const file of ['index.html']) {
  let html = readFileSync(file, 'utf8')
  const before = html
  // sha block
  html = html.replace(/<pre id="sha256">[0-9a-f]{64}<\/pre>/, `<pre id="sha256">${rel.sha256}</pre>`)
  html = html.replace(/<pre id="sha512">[0-9a-f]{128}<\/pre>/, `<pre id="sha512">${rel.sha512}</pre>`)
  html = html.replace(/(<span id="build-date">)[^<]+(<\/span>)/, `$1${rel.buildDate}$2`)
  // version marker + filename mentions + size
  html = html.replace(/(<strong id="version">)[^<]+(<\/strong>)/, `$1${rel.version}$2`)
  html = html.replace(/gMatch-\d+\.\d+\.\d+-portable\.exe/g, rel.file)
  if (rel.sizeBytes) {
    const mib = (rel.sizeBytes / (1024 * 1024)).toFixed(1)
    const bytesFormatted = Number(rel.sizeBytes).toLocaleString('en-US')
    html = html.replace(/· [\d,]+ bytes \([^)]+\) · built/, `· ${bytesFormatted} bytes (${mib} MiB) · built`)
  }
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
