// Run from site/: node build-release.mjs ../../apps/desktop/release/goonMatch-Grid-<ver>-portable.exe
// Copies the artifact into releases/ and writes release.json FROM THE FILE —
// the published hash is never hand-typed.
import { copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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
const sha = createHash('sha256').update(readFileSync(join('releases', name))).digest('hex')
const version = name.match(/(\d+\.\d+\.\d+)/)[1]
writeFileSync(
  'release.json',
  JSON.stringify({ file: name, version, sha256: sha, sizeBytes: readFileSync(join('releases', name)).length }, null, 2) + '\n',
)
console.log('release.json written:', name, sha)
