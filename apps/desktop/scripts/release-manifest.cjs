#!/usr/bin/env node
// Build the GitHub Release body from the ACTUAL staged artifacts. Runs on
// every OS runner with plain Node (no PowerShell), so the published hash and
// verification instructions always describe the bytes being uploaded.
//
// Usage: node scripts/release-manifest.cjs --dir <artifactsDir> --out <body.md>
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const dir = arg('--dir', path.join(__dirname, '..', 'release'))
const out = arg('--out')
const ARTIFACT_RE = /^gMatch-\d+(?:\.\d+)*-portable\.(exe|appimage|deb|dmg)$/i

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function main() {
  if (!fs.existsSync(dir)) throw new Error(`artifact directory missing: ${dir}`)
  const files = fs.readdirSync(dir)
    .filter((f) => ARTIFACT_RE.test(f))
    .map((f) => {
      const full = path.join(dir, f)
      return { name: f, ext: path.extname(f).toLowerCase(), bytes: fs.statSync(full).size, sha256: sha256(full) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!files.length) throw new Error(`no portable artifacts in ${dir}`)

  const lines = [
    `Verify the download before running. Each hash below was computed from the exact artifact attached to this release.`,
    '',
  ]
  for (const f of files) {
    lines.push(`### ${f.name}`)
    lines.push('')
    lines.push(`- Size: ${f.bytes} bytes`)
    lines.push(`- SHA-256: \`${f.sha256}\``)
    if (f.ext === '.exe') {
      lines.push('- Windows (PowerShell):')
      lines.push('  ~~~')
      lines.push(`  Get-FileHash "$env:USERPROFILE\\Downloads\\${f.name}" -Algorithm SHA256`)
      lines.push('  ~~~')
      lines.push('- Unsigned binary ⇒ SmartScreen "More info → Run anyway" is expected.')
    } else if (f.ext === '.appimage') {
      lines.push('- Linux:')
      lines.push('  ~~~')
      lines.push(`  sha256sum ${f.name}   # compare with the hash above`)
      lines.push(`  chmod +x ${f.name} && ./${f.name}`)
      lines.push('  ~~~')
    } else if (f.ext === '.deb') {
      lines.push('- Linux (Debian/Ubuntu):')
      lines.push('  ~~~')
      lines.push(`  sha256sum ${f.name}   # compare with the hash above`)
      lines.push(`  sudo apt install ./${f.name}`)
      lines.push('  ~~~')
    } else {
      lines.push('- macOS:')
      lines.push('  ~~~')
      lines.push(`  shasum -a 256 ${f.name}   # compare with the hash above`)
      lines.push('  ~~~')
    }
    lines.push('')
  }
  lines.push('Public scan: https://www.virustotal.com (paste the file or hash).')
  lines.push(`Reproducible: clone this repo at tag \${{ github.ref_name || github.sha }} and run \`npm ci && npm run dist\`.`)
  const body = lines.join('\n') + '\n'
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
    fs.writeFileSync(out, body)
  }
  for (const f of files) console.log(`[release-manifest] ${f.name} (${f.bytes} bytes) sha256=${f.sha256}`)
}

try { main() } catch (err) {
  console.error('[release-manifest] failed:', err?.message || err)
  process.exitCode = 1
}
