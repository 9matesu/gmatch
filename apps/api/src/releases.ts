import { existsSync, statSync, createReadStream } from 'node:fs'
import { join, basename } from 'node:path'
import { Readable } from 'node:stream'

/**
 * The release feed a NODE can serve (roadmap L8, "the artifact served by
 * peers").
 *
 * The central release hosts are decommissioned, so the artifact has to travel
 * between the people who use the app. A node that has the portable build in
 * its releases directory serves it:
 *
 *   GET /release.json          -> { file, version, sha256, sizeBytes }
 *   GET /releases/<file>       -> the bytes
 *
 * The manifest is the same shape the updater already understands, so an
 * installed app pointed at such a node updates itself from a PEER. The hash
 * in the manifest is what makes the download safe to trust: the updater
 * verifies it and refuses a mismatch.
 *
 * The directory is empty by default: a node serves releases only if its
 * operator put one there.
 */

export interface ReleaseEnv {
  RELEASES_DIR?: string
}

export interface ReleaseManifest {
  file: string
  version: string
  sha256: string
  sizeBytes?: number
  publishedAt?: string
}

/** Where the releases live, or null when this node hosts none. */
export function releasesDir(env?: ReleaseEnv): string | null {
  const dir = env?.RELEASES_DIR || process.env.RELEASES_DIR
  const trimmed = typeof dir === 'string' ? dir.trim() : ''
  return trimmed ? trimmed : null
}

/** Only plain file names: no path traversal, no subdirectories. */
export function safeReleaseName(name: string): string | null {
  const clean = basename(String(name || ''))
  if (!clean || clean === '.' || clean === '..') return null
  if (!/^[A-Za-z0-9._-]+$/.test(clean)) return null
  return clean
}

/**
 * Serve a release path. Returns null when the path is not a release path at
 * all (the caller then falls through to its normal handling).
 */
export async function serveRelease(pathname: string, env?: ReleaseEnv): Promise<Response | null> {
  const dir = releasesDir(env)
  if (!dir) return null

  if (pathname === '/release.json') {
    const file = join(dir, 'release.json')
    if (!existsSync(file)) return new Response('Not Found', { status: 404 })
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (pathname.startsWith('/releases/')) {
    const name = safeReleaseName(pathname.slice('/releases/'.length))
    if (!name) return new Response('Not Found', { status: 404 })
    const file = join(dir, name)
    if (!existsSync(file)) return new Response('Not Found', { status: 404 })
    const stat = statSync(file)
    if (!stat.isFile()) return new Response('Not Found', { status: 404 })
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stat.size),
      },
    })
  }

  return null
}
