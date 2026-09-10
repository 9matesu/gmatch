// Run from site/: node build-legal.mjs
// Renders the legal .md corpus (generated from the canonical TS source by
// apps/desktop/scripts/gen-legal.cjs) into plain-text HTML in legal/.
// NO styling, NO scripts — the honesty gate (check.mjs) enforces that.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const MD = join(ROOT, '..', 'apps', 'desktop', 'public', 'legal')
const OUT = join(ROOT, 'legal')
mkdirSync(OUT, { recursive: true })

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Minimal, safe markdown-ish -> plain HTML (headings, bullets, bold, code, pre). */
function mdToHtml(md) {
  const lines = md.split(/\r?\n/)
  const out = []
  let inList = false
  let inPre = false
  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('```')) {
      closeList()
      if (inPre) {
        out.push('</pre>')
        inPre = false
      } else {
        out.push('<pre>')
        inPre = true
      }
      continue
    }
    if (inPre) {
      out.push(esc(raw))
      continue
    }
    if (/^\|.*\|$/.test(line.trim())) {
      // tables (audit findings): render verbatim inside a pre for alignment
      if (!out.at(-1) || !out.at(-1).endsWith('<pre>')) {
        closeList()
        out.push('<pre>')
      }
      out.push(esc(line.trim()))
      if (!/^\|/.test(lines[lines.indexOf(raw) + 1]?.trim() ?? '')) out.push('</pre>')
      continue
    }
    let m
    if ((m = /^### (.*)$/.exec(line))) {
      closeList()
      out.push(`<h3>${inline(m[1])}</h3>`)
    } else if ((m = /^## (.*)$/.exec(line))) {
      closeList()
      out.push(`<h2>${inline(m[1])}</h2>`)
    } else if ((m = /^# (.*)$/.exec(line))) {
      closeList()
      out.push(`<h1>${inline(m[1])}</h1>`)
    } else if ((m = /^[-*] (.*)$/.exec(line))) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(m[1])}</li>`)
    } else if (line.trim() === '') {
      closeList()
    } else {
      closeList()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  closeList()
  if (inPre) out.push('</pre>')
  return out.join('\n')
}

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function page(title, bodyHtml, note) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — gMatch</title>
</head>
<body>
<p><a href="../index.html#terms">← back to the main page</a></p>
${note ? `<p><em>${esc(note)}</em></p>` : ''}
${bodyHtml}
<hr>
<p>Contact: <a href="https://github.com/9matesu/goongrid/issues">github.com/9matesu/goongrid/issues</a> · This page uses no JavaScript, CSS, cookies or analytics.</p>
</body>
</html>
`
}

if (!existsSync(MD)) {
  console.error('run gen-legal.cjs first (apps/desktop): node scripts/gen-legal.cjs')
  process.exit(1)
}

const mapped = {
  'terms.html': ['terms.md', 'Terms of Use', null],
  'privacy.html': ['privacy.md', 'Privacy Policy', null],
  'community.html': ['community.md', 'Community Rules', null],
  'abuse.html': ['abuse.md', 'Abuse Reports & Notice-and-Takedown', null],
  'records.html': ['records.md', 'Adult Content & Records', null],
  'e2e.html': ['e2e-disclaimer.md', 'Encryption & Self-Custody Disclaimer', null],
}
let n = 0
for (const [html, [md, title, note]] of Object.entries(mapped)) {
  const src = readFileSync(join(MD, md), 'utf8')
  writeFileSync(join(OUT, html), page(title, mdToHtml(src), note ?? 'Generated from the canonical in-app source — do not edit here.'))
  n++
}

// changelog: version registry from version.json + per-doc section anchors
const version = JSON.parse(readFileSync(join(MD, 'version.json'), 'utf8'))
const cl = [
  '<h1>Legal changelog</h1>',
  `<p>Current suite: <strong>${esc(version.version)}</strong></p>`,
  `<table><tr><th>document</th><th>version</th></tr>` +
    version.docs.map((d) => `<tr><td><a href="${d === 'e2e-disclaimer' ? 'e2e' : d}.html">${esc(d)}</a></td><td>${esc(version.version)}</td></tr>`).join('') +
    '</table>',
  '<p>2026-09-09.2 — English-only binding corpus (terms, LGPD/GDPR privacy, community, abuse reports, adult records, E2E notice).</p>',
].join('\n')
writeFileSync(join(OUT, 'changelog.html'), page('Legal changelog', cl, 'Generated from legal/version.json — canonical source: apps/desktop/src/legal/documents.ts.'))
n++

// security page: the audit report itself
const auditPath = join(ROOT, '..', 'docs', 'SECURITY-AUDIT.md')
const audit = readFileSync(auditPath, 'utf8')
writeFileSync(join(OUT, 'security.html'), page('Security Audit', mdToHtml(audit), 'Generated from docs/SECURITY-AUDIT.md (white-box).'))
n++
console.log(`build-legal: ${n} EN pages -> legal/`)
