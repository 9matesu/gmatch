#!/usr/bin/env node
// Stage the built portable build into a NODE's releases directory, so the
// node serves it to its peers.
//
// Why: the central release hosts are decommissioned (the accounts cannot be
// paid for). The update feed now travels between the people who use the app:
// a node that has the artifact serves it at
//
//   GET /release.json        -> { file, version, sha256, sizeBytes }
//   GET /releases/<file>     -> the bytes
//
// and the installed app (which asks the node it is connected to) updates
// itself from there. The manifest's sha256 is what makes the download safe:
// the updater verifies it and discards a mismatch.
//
// Usage:
//   node scripts/stage-release.cjs [--dir <releasesDir>] [--exe <path>]
//
// Default dir: %APPDATA%\gmatch\releases (the packaged app's userData, where
// the bundled node looks for it).
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.join(__dirname, '..')

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : ''
}

function defaultReleasesDir() {
  const base = process.env.APPDATA || path.join(process.homedir(), 'AppData', 'Roaming')
  return path.join(base, 'gmatch', 'releases')
}

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  } catch {
    return ''
  }
}

function findExe(explicit) {
  if (explicit) return fs.existsSync(explicit) ? explicit : null
  const releaseDir = path.join(root, 'release')
  if (!fs.existsSync(releaseDir)) return null
  const wanted = `gMatch-${version()}-portable.exe`
  const direct = path.join(releaseDir, wanted)
  if (fs.existsSync(direct)) return direct
  const candidates = fs.readdirSync(releaseDir).filter((f) => /^gMatch-.*-portable\.exe$/i.test(f))
  if (!candidates.length) return null
  // The newest-looking one: the version is in the name.
  candidates.sort()
  return path.join(releaseDir, candidates[candidates.length - 1])
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
  const exe = findExe(arg('--exe'))
  if (!exe) {
    console.error('[stage-release] no portable build found. Run `npm run dist` first.')
    process.exitCode = 1
    return
  }
  fs.mkdirSync(dir, { recursive: true })
  const name = path.basename(exe)
  const target = path.join(dir, name)
  fs.copyFileSync(exe, target)
  const digest = await sha256File(target)
  const sizeBytes = fs.statSync(target).size
  const manifest = {
    file: name,
    version: (name.match(/gMatch-(\d+(?:\.\d+)*)-portable\.exe/i) || [])[1] || version(),
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
