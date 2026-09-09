// Run from site/: node build-legal.mjs
// Renders the legal .md corpus (generated from the canonical TS source by
// apps/desktop/scripts/gen-legal.cjs) into plain-text HTML in legal/.
// NO styling, NO scripts — the honesty gate (check.mjs) enforces that.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
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
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — goonMatch Grid</title>
</head>
<body>
<p><a href="../index.html#termos">← voltar para a página principal</a></p>
${note ? `<p><em>${esc(note)}</em></p>` : ''}
${bodyHtml}
<hr>
<p>Contato: <a href="https://github.com/9matesu/goongrid/issues">github.com/9matesu/goongrid/issues</a> · Esta página não usa JavaScript, CSS, cookies ou analytics.</p>
</body>
</html>
`
}

if (!existsSync(MD)) {
  console.error('run gen-legal.cjs first (apps/desktop): node scripts/gen-legal.cjs')
  process.exit(1)
}

const mapped = {
  'terms.html': ['terms.md', 'Termos de Uso', null],
  'privacy.html': ['privacy.md', 'Política de Privacidade', null],
  'community.html': ['community.md', 'Regras da Comunidade', null],
  'abuse.html': ['abuse.md', 'Denúncias e Notice-and-Takedown', null],
  'records.html': ['records.md', 'Conteúdo Adulto e Registros', null],
  'e2e.html': ['e2e-disclaimer.md', 'Declaração sobre Criptografia e Autocustódia', null],
}
let n = 0
for (const [html, [md, title, note]] of Object.entries(mapped)) {
  const src = readFileSync(join(MD, md), 'utf8')
  writeFileSync(join(OUT, html), page(title, mdToHtml(src), note ?? 'Documento gerado a partir do fonte canônico do aplicativo — não editar aqui.'))
  n++
}

// changelog: version registry from version.json + per-doc section anchors
const version = JSON.parse(readFileSync(join(MD, 'version.json'), 'utf8'))
const cl = [
  '<h1>Changelog jurídico</h1>',
  `<p>Corrente / current suite: <strong>${esc(version.version)}</strong></p>`,
  '<table><tr><th>documento</th><th>versão</th></tr>' +
    version.docs.map((d) => `<tr><td><a href="${d === 'e2e-disclaimer' ? 'e2e' : d}.html">${esc(d)}</a></td><td>${esc(version.version)}</td></tr>`).join('') +
    '</table>',
  '<p>2026-09-09.1 — versão inicial pública do pacote jurídico (termos, privacidade LGPD/GDPR, comunidade, denúncias, registros adultos, aviso E2E), alinhada ao relatório de segurança abaixo.</p>',
].join('\n')
writeFileSync(join(OUT, 'changelog.html'), page('Changelog jurídico', cl, 'Gerado de legal/version.json — fonte canônico: apps/desktop/src/legal/documents.ts.'))
n++

// security page: the audit report itself
const auditPath = join(ROOT, '..', 'docs', 'SECURITY-AUDIT.md')
const audit = readFileSync(auditPath, 'utf8')
writeFileSync(join(OUT, 'security.html'), page('Auditoria de Segurança', mdToHtml(audit), 'Gerado de docs/SECURITY-AUDIT.md (white-box).'))
n++

// EN mirrors (informational)
const EN_OUT = join(OUT, 'en')
mkdirSync(EN_OUT, { recursive: true })
for (const [html, [md, , ]] of Object.entries(mapped)) {
  const src = readFileSync(join(MD, 'en', md), 'utf8')
  const title = /^# (.*)$/m.exec(src)?.[1] ?? md
  writeFileSync(join(EN_OUT, html), `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)} — goonMatch Grid</title>\n</head>\n<body>\n<p><a href="../../en.html#terms">← back to the main page</a></p>\n<p><em>Informational translation — the PT-BR text binds. Generated from the canonical in-app source — do not edit here.</em></p>\n${mdToHtml(src)}\n<hr>\n<p>Contact: <a href="https://github.com/9matesu/goongrid/issues">github.com/9matesu/goongrid/issues</a> · This page uses no JavaScript, CSS, cookies or analytics.</p>\n</body>\n</html>\n`)
}
console.log(`build-legal: ${n} PT pages + ${Object.keys(mapped).length} EN mirrors -> legal/`)
console.log('legal files now:', readdirSync(OUT).sort().join(' '))
