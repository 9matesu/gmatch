// node site/check.mjs  → exit 0 + "OK" when the site is honest.
// THE HONESTY GATE: this page may not claim anything the files don't back.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const legalDir = join(ROOT, 'legal')
const legalPages = existsSync(legalDir)
  ? readdirSync(legalDir).filter((f) => f.endsWith('.html')).map((f) => `legal/${f}`)
  : []
const pages = ['index.html', 'en.html', ...legalPages].filter((p) => existsSync(join(ROOT, p)))
if (pages.length < 2 + legalPages.length) {
  console.error('CHECK FAILED: missing base pages (index.html/en.html)')
  process.exit(1)
}
const fail = []

// 1) nenhum recurso/destino externo além dos allowlisted
const ALLOW = /^https:\/\/(github\.com\/9matesu\/goongrid|www\.virustotal\.com)(\/|$)/
for (const p of pages) {
  const html = readFileSync(join(ROOT, p), 'utf8')
  for (const m of html.matchAll(/(?:src|href|action)="(https?:[^"]+)"/g))
    if (!ALLOW.test(m[1])) fail.push(`${p}: external URL ${m[1]}`)
  for (const m of html.matchAll(/<(script|style|link|iframe|img)[^>]*>/gi)) {
    const tag = m[0]
    if (/<link\b/i.test(tag) || /<style\b/i.test(tag) || /<script\b/i.test(tag)) fail.push(`${p}: styling/script tag banned: ${tag.slice(0, 60)}`)
    if (/<img\b/i.test(tag) && !/src="data:image/.test(tag)) fail.push(`${p}: external <img> banned`)
  }
}

// 2) SHA-256 publicado == arquivo real
const rel = JSON.parse(readFileSync(join(ROOT, 'release.json'), 'utf8'))
const exe = join(ROOT, 'releases', rel.file)
if (!existsSync(exe)) fail.push(`releases/${rel.file} missing`)
else {
  const real = createHash('sha256').update(readFileSync(exe)).digest('hex')
  if (real !== rel.sha256) fail.push(`sha256 mismatch: site ${rel.sha256} != file ${real}`)
}
for (const p of ['index.html', 'en.html']) {
  const html = readFileSync(join(ROOT, p), 'utf8')
  const shown = /id="sha256">([0-9a-f]{64})</.exec(html)?.[1]
  if (shown !== rel.sha256) fail.push(`${p}: published sha256 ${shown} != release.json ${rel.sha256}`)
  const ver = /id="version">([^<]+)</.exec(html)?.[1]
  if (ver !== rel.version) fail.push(`${p}: published version ${ver} != release.json ${rel.version}`)
}

// 3) âncoras internas resolvem + 4) seções obrigatórias (PT e EN espelhos)
const SECTIONS = {
  'index.html': ['o-que-e', 'seguranca', 'criptografia', 'download', 'verificar', 'termos', 'privacidade'],
  'en.html': ['what-it-is', 'security', 'crypto', 'download', 'verify', 'terms', 'privacy'],
}
for (const [file, ids] of Object.entries(SECTIONS)) {
  const html = readFileSync(join(ROOT, file), 'utf8')
  for (const m of html.matchAll(/href="#([^"]+)"/g))
    if (!new RegExp(`id="${m[1]}"`).test(html)) fail.push(`${file}: broken anchor #${m[1]}`)
  for (const id of ids) if (!html.includes(`id="${id}"`)) fail.push(`${file}: missing section #${id}`)
  // the download link must point at the actual file in releases/
  if (!html.includes(`href="releases/${rel.file}"`)) fail.push(`${file}: download href != releases/${rel.file}`)
}

if (fail.length) {
  console.error('CHECK FAILED:')
  fail.forEach((f) => console.error(' -', f))
  process.exit(1)
}
console.log('OK')
