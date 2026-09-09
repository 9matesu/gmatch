// Generate the public legal corpus from the CANONICAL TS source (plan C.3).
// node apps/desktop/scripts/gen-legal.mjs
// Outputs (relative to apps/desktop/):
//   public/legal/<id>.md          — EN binding text, downloadable/indexable
//   public/legal/version.json     — { key, docs } the acceptance key mirrors
// CI gate (anti-drift): `node scripts/gen-legal.mjs && git diff --exit-code public/legal/`
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'legal')

// The TS source is the law; parse its string arrays without executing TS:
// a tiny regex extraction is enough because documents.ts is machine-formatted.
function parseDocs(tsFile) {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'legal', tsFile), 'utf8')
  const docs = {}
  // match blocks:  id: { ... title: '...', version: LEGAL_VERSION, updated: '...', jurisdiction: '...', body: [ ... ] }
  const docRe = /\n\s{2}(?:'([a-z][a-z0-9-]*)'|([a-z][a-z0-9-]*))\s*:\s*\{[\s\S]*?title:\s*'((?:[^'\\]|\\.)*)',[\s\S]*?updated:\s*'((?:[^'\\]|\\.)*)',[\s\S]*?jurisdiction:\s*'((?:[^'\\]|\\.)*)',[\s\S]*?body:\s*\[([\s\S]*?)\n {4}\],/g
  let m
  while ((m = docRe.exec(src))) {
    const [, gQuoted, gPlain, title, updated, jurisdiction, bodyRaw] = m
    const id = gQuoted || gPlain
    const body = []
    const lineRe = /'((?:[^'\\]|\\.)*)'/g
    let l
    while ((l = lineRe.exec(bodyRaw))) {
      // unescape TS single-quote string literals
      body.push(l[1].replace(/\\'/g, "'").replace(/\\u0027/g, "'").replace(/\\\\/g, '\\'))
    }
    docs[id] = { id, title, updated, jurisdiction, body }
  }
  return docs
}

const versionLine = fs.readFileSync(path.join(ROOT, 'src', 'legal', 'documents.ts'), 'utf8').match(/LEGAL_VERSION = '([^']+)'/)
if (!versionLine) throw new Error('LEGAL_VERSION not found in documents.ts')
const VERSION = versionLine[1]

const corpus = parseDocs('documents.ts')

function markdown(d, header) {
  const out = [`# ${d.title}`, '', `_${header}_: **${VERSION}** · updated: ${d.updated}`, `Jurisdiction: ${d.jurisdiction}`, '']
  for (const line of d.body) {
    out.push(line, '')
  }
  return out.join('\n').trimEnd() + '\n'
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const ids = Object.keys(corpus).sort()
for (const id of ids) {
  if (!corpus[id]) throw new Error(`corpus mismatch for ${id}`)
  fs.writeFileSync(path.join(OUT, `${id}.md`), markdown(corpus[id], 'Binding text (EN)'))
}
// acceptance key MUST mirror legalVersionKey(): `${id}@${version}` sorted, ';'
const key = ids.map((id) => `${id}@${VERSION}`).sort().join(';')
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ key, version: VERSION, docs: ids }, null, 2) + '\n')
console.log(`gen-legal: ${ids.length} docs (EN binding) -> public/legal/ (key ${key.length} chars)`)
