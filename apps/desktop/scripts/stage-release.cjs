#!/usr/bin/env node
// Stage the built portable build into a NODE's releases directory, so the
// node serves it to its peers.
//
// Why: the node this install talks to can also serve its own artifact to the
// people connected to it — so the update feed travels between peers as well
// as from the project's GitHub Release. A node that has the artifact serves it
// at
//
//   GET /release.json        -> { file, version, sha256, sizeBytes }
//   GET /releases/<file>     -> the bytes
//
// and the installed app (which asks the node it is connected to) updates
// itself from there. The manifest's sha256 is what makes the download safe:
// the updater verifies it and discards a mismatch.
//
// Usage:
//   node scripts/stage-release.cjs [--dir <releasesDir>] [--artifact <path>]
//
// Default dir: the Electron userData/releases path for this OS:
//   Windows %APPDATA%\<appName>\releases
//   Linux   $XDG_CONFIG_HOME/<appName>/releases (or ~/.config/<appName>)
//   macOS   ~/Library/Application Support/<appName>/releases
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.join(__dirname, '..')

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : ''
}

function defaultReleasesDir() {
  const home = os.homedir()
  let base
  if (process.platform === 'win32') {
    base = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  } else if (process.platform === 'darwin') {
    base = path.join(home, 'Library', 'Application Support')
  } else {
    base = process.env.XDG_CONFIG_HOME || path.join(home, '.config')
  }
  // Electron's userData is appData/<package.json name> — NOT productName
  // (that lives under `build` and names the artifact). The name is scoped
  // ("@gmatch/desktop"), i.e. a nested folder; the sidecar is started with
  // RELEASES_DIR = userData/releases (electron/apiSidecar.cjs), so staging
  // anywhere else means the node serves nothing.
  let appName = 'gmatch'
  try {
    appName = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name || appName
  } catch { /* keep the fallback */ }
  return path.join(base, appName, 'releases')
}

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  } catch {
    return ''
  }
}

const PORTABLE_RE = /^gMatch-(\d+(?:\.\d+)*)-portable\.(exe|appimage|deb|dmg)$/i

function findArtifact(explicit) {
  if (explicit) return fs.existsSync(explicit) ? explicit : null
  const releaseDir = path.join(root, 'release')
  if (!fs.existsSync(releaseDir)) return null
  // All platforms share one output dir; a build on this machine may contain
  // the Windows exe, the Linux AppImage/deb, or both. Prefer THIS version,
  // then the newest-looking portable artifact.
  const candidates = fs.readdirSync(releaseDir).filter((f) => PORTABLE_RE.test(f))
  if (!candidates.length) return null
  const wanted = `gMatch-${version()}-portable`
  const exact = candidates.filter((f) => f.toLowerCase().startsWith(wanted.toLowerCase()))
  let pool = exact.length ? exact : candidates
  // A node serves the artifact THIS OS can swap: a .deb is published for
  // distro packaging but is not a portable update target, so it must never
  // shadow the AppImage in the node's release.json.
  const ext = { win32: '.exe', linux: '.AppImage', darwin: '.AppImage' }[process.platform]
  if (ext) {
    const swappable = pool.filter((f) => f.toLowerCase().endsWith(ext.toLowerCase()))
    if (swappable.length) pool = swappable
  }
  pool.sort()
  return path.join(releaseDir, pool[pool.length - 1])
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function main() {
  const dir = arg('--dir') || defaultReleasesDir()
  const artifact = findArtifact(arg('--artifact') || arg('--exe'))
  if (!artifact) {
    console.error('[stage-release] no portable build found. Run `npm run dist` first.')
    process.exitCode = 1
    return
  }
  fs.mkdirSync(dir, { recursive: true })
  const name = path.basename(artifact)
  const target = path.join(dir, name)
  fs.copyFileSync(artifact, target)
  const digest = await sha256File(target)
  const sizeBytes = fs.statSync(target).size
  const manifest = {
    file: name,
    version: (name.match(PORTABLE_RE) || [])[1] || version(),
    sha256: digest,
    sizeBytes,
    publishedAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify(manifest, null, 2))
  console.log(`[stage-release] ${name} (${sizeBytes} bytes) staged in ${dir}`)
  console.log(`[stage-release] sha256=${digest}`)
}

main().catch((err) => {
  console.error('[stage-release] failed:', err?.message || err)
  process.exitCode = 1
})
