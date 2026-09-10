// Run from site/: node build-legal.mjs
// Renders the legal .md corpus (generated from the canonical TS source by
// apps/desktop/scripts/gen-legal.cjs) into HTML in legal/.
// Inline styling only, NO scripts — the honesty gate (check.mjs) enforces that.
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
<style>
:root { color-scheme: dark; }
html { background: #09090b; }
body {
  margin: 0;
  padding: 56px 32px 96px;
  max-width: 560px;
  background: #09090b;
  color: #d4d4d8;
  font: 13px/1.7 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  letter-spacing: -0.08em;
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, strong { color: #fafafa; font-weight: 600; }
h1 { font-size: 21px; line-height: 1.25; margin: 0 0 16px; }
h2 { font-size: 14px; margin: 40px 0 12px; }
h3 { font-size: 13px; margin: 28px 0 10px; }
p { margin: 0 0 14px; }
em { color: #71717a; }
a { color: #fafafa; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: #3f3f46; }
a:hover { color: #fff; text-decoration-color: #fff; }
ul { margin: 0 0 16px; padding-left: 20px; }
li { margin: 7px 0; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px; letter-spacing: normal;
  background: #121215; border: 1px solid #1f1f23; border-radius: 4px;
  padding: 1px 5px; color: #e4e4e7;
}
pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px; letter-spacing: normal; line-height: 1.65;
  background: #121215; border: 1px solid #27272a; border-radius: 6px;
  padding: 14px 16px; margin: 0 0 16px; color: #fafafa;
  overflow-wrap: anywhere; white-space: pre-wrap;
}
hr { border: 0; border-top: 1px solid #1f1f23; margin: 56px 0 20px; }
table { border-collapse: collapse; margin: 0 0 16px; }
th, td { border: 1px solid #27272a; padding: 6px 12px; text-align: left; font-weight: 500; }
::selection { background: rgba(255, 255, 255, 0.15); }
@media (max-width: 480px) { body { padding: 40px 20px 72px; } }
</style>
</head>
<body>
<p><a href="../index.html#terms">← back to the main page</a></p>
${note ? `<p><em>${esc(note)}</em></p>` : ''}
${bodyHtml}
<hr>
<p>Contact: <a href="https://github.com/9matesu/goongrid/issues">github.com/9matesu/goongrid/issues</a> · This page uses no JavaScript, no external fonts, no cookies and no analytics.</p>
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
