// Run from site/: node build-release.mjs ../../apps/desktop/release/gMatch-<ver>-portable.exe
// Copies the artifact into releases/ and writes release.json FROM THE FILE —
// the published hash is never hand-typed.
import { copyFileSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename, resolve } from 'node:path'

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
const buf = readFileSync(join('releases', name))
const sha = createHash('sha256').update(buf).digest('hex')
const sha512 = createHash('sha512').update(buf).digest('hex')
const buildDate = process.env.BUILD_DATE || statSync(join('releases', name)).mtime.toISOString()
const version = name.match(/(\d+\.\d+\.\d+)/)[1]
// downloadUrl is OPT-IN: the canonical public link is the on-site
// /releases/<file> copy (fly serves it). GitHub Releases URLs are only
// written when explicitly provided (private repo has none — do not lie).
const out = { file: name, version, sha256: sha, sha512, buildDate, sizeBytes: buf.length }
if (process.env.GH_DOWNLOAD_URL) out.downloadUrl = process.env.GH_DOWNLOAD_URL
writeFileSync('release.json', JSON.stringify(out, null, 2) + '\n')
console.log('release.json written:', name, sha, buildDate)
