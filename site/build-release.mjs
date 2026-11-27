// Run from site/: node build-release.mjs ../../apps/desktop/release/gMatch-<ver>-portable.exe
// Copies the artifact into releases/ and writes release.json FROM THE FILE —
// the published hash is never hand-typed.
import { copyFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename, resolve } from 'node:path'
import { createReadStream } from 'node:fs'

const src = process.argv[2]
if (!src || !existsSync(resolve(src))) {
  console.error('usage: node build-release.mjs <path-to-portable.exe>')
  process.exit(1)
}
const name = basename(src)
if (!/-portable\.exe$/.test(name)) {
  console.error(`unexpected artifact name: ${name}`)
  process.exit(1)
}
copyFileSync(src, join('releases', name))
const dest = join('releases', name)
const sha = createHash('sha256')
const sha512 = createHash('sha512')
await new Promise((resolveStream, reject) => {
  const stream = createReadStream(dest)
  stream.on('data', (chunk) => { sha.update(chunk); sha512.update(chunk) })
  stream.on('end', resolveStream)
  stream.on('error', reject)
})
const buildDate = process.env.BUILD_DATE || statSync(dest).mtime.toISOString()
const version = name.match(/(\d+\.\d+\.\d+)/)[1]
// downloadUrl is the canonical GitHub Release asset: the site artifact never
// carries binaries, so the page links the published bytes by absolute URL.
const out = {
  file: name,
  version,
  sha256: sha.digest('hex'),
  sha512: sha512.digest('hex'),
  buildDate,
  sizeBytes: statSync(dest).size,
}
if (process.env.GH_DOWNLOAD_URL) out.downloadUrl = process.env.GH_DOWNLOAD_URL
writeFileSync('release.json', JSON.stringify(out, null, 2) + '\n')
console.log('release.json written:', name, out.sha256, buildDate, out.sizeBytes)
