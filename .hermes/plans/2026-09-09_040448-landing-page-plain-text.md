# goonMatch Grid — Landing page 100% texto ("plain trust"): download do .exe + transparência total

> **STATUS DE EXECUÇÃO (2026-09-09, branch `security/audit-hardening`):** Fase B do plano de segurança em andamento (B.1 runtime-only cache em verde-partial). Este plano permanece na ordem: **B.2-B.7 → Fase C (legal) → L1-L3 (landing)**. Ao executar L1.4/L2.2, atualizar a versão do exe e o hash via `build-release.mjs` a partir do rebuild pós-segurança (v1.1.0), não do 1.0.1.

> **Para a Hermes:** executar task-por-task; gate em cada commit: `cd /i/goongrid && npm run lint` (0 erros) + `npm run test` (todos verdes) + `node site/check.mjs` (exit 0). Branch: `feat/landing-page` a partir de `feat/secure-p2p-phase1`.

**Goal:** Landing estática em HTML puro (zero CSS/JS/fontes externas) hospedada no site oficial, que explica o app, expõe segurança/criptografia/termos/privacidade e serve o download do `.exe` portable com SHA-256 verificável — maximizando confiança de quem baixa um executável não-assinado.

**Contexto / premissas:**
- Repo `I:/goongrid`; artefato atual: `apps/desktop/release/goonMatch-Grid-1.0.1-portable.exe` (~114MB, electron-builder portable, sem code-signing → SmartScreen avisa).
- `docs/SECURITY-AUDIT.md` e o pacote jurídico versionado (`apps/desktop/src/legal/documents.ts` + `public/legal/*.md`) vêm dos planos `2026-09-08_224510` (courier), `2026-09-09_030251` (UI) e `2026-09-09_034247` (segurança/legal). **Ordem de execução: este plano roda DEPOIS do Phase C daquele plano** — a landing espelha os mesmos textos (fonte único, §DRY). Se ainda não existirem, esta landing usa a cópia PT concisa embutida nas tasks e marca `TODO(legal-sync)`.
- Idioma primário PT-BR (página `/`), espelho EN (`/en.html`). Usuário final baixa num Windows sem dev-tools → instruções de verificação com ferramentas que já vêm no Windows.
- Hospedagem: GitHub Pages do repo (`.github/workflows/deploy-site.yml` publicando `site/`); o binário vai junto no artefato do Pages (`site/releases/…`) para link relativo honesto e hash verificável na mesma origem.

**Arquitetura:** `site/` é um diretório de HTML estático controlado no git (`index.html`, `en.html`, `legal/*.html`, `releases/`, `check.mjs`, `build-release.mjs`). Regras duras testadas por `check.mjs`: (1) nenhum `http(s)://` externo em `src/href/link` exceto `github.com/<repo>` e `virustotal.com`; (2) o SHA-256 publicado casa byte-a-byte com o `.exe` presente em `site/releases/`; (3) todas as âncoras internas resolvem; (4) as seções obrigatórias existem. Zero framework — "sem estilização" é a feature (página de documento, não marketing).

---

## Phase L1 — Esqueleto + verificação mecânica

### L1.1 Estrutura de diretórios (~3 min)
```bash
cd /i/goongrid && mkdir -p site/legal site/releases
```
Copy `apps/desktop/release/goonMatch-Grid-1.0.1-portable.exe` para `site/releases/` via script (L1.4), nunca `cp` manual (fonte do hash é o script).

### L1.2 `site/check.mjs` — o gate de honestidade (~15 min, TDD: ele nasce RED)
Create `site/check.mjs`:

```js
// node site/check.mjs  → exit 0 + "OK" quando o site é honesto.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const pages = ['index.html', 'en.html', ...readdirSync(join(ROOT, 'legal')).filter(f => f.endsWith('.html')).map(f => `legal/${f}`)]
const fail = []

// 1) nenhum recurso/destino externo além dos allowlisted
const ALLOW = /^https:\/\/(github\.com\/9matesu\/goongrid|www\.virustotal\.com)\//
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

// 3) âncoras internas resolvem + 4) seções obrigatórias
const index = readFileSync(join(ROOT, 'index.html'), 'utf8')
for (const m of index.matchAll(/href="#([^"]+)"/g))
  if (!new RegExp(`id="${m[1]}"`).test(index)) fail.push(`broken anchor #${m[1]}`)
for (const id of ['o-que-e', 'seguranca', 'criptografia', 'download', 'verificar', 'termos', 'privacidade'])
  if (!index.includes(`id="${id}"`)) fail.push(`missing section #${id}`)

if (fail.length) { console.error('CHECK FAILED:'); fail.forEach(f => console.error(' -', f)); process.exit(1) }
console.log('OK')
```
RED: `node site/check.mjs` → crash (sem release.json/index) — **era isso que se queria ver**. GREEN só ao fim de L1.4/L2. Commit: `feat(site): honesty checker (no external refs, sha256 match, anchors, sections)`.

### L1.3 `site/build-release.mjs` — hash do artefato (~10 min)
Create `site/build-release.mjs`:

```js
// Run from site/: node build-release.mjs ../../apps/desktop/release/goonMatch-Grid-1.0.1-portable.exe
import { copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
const src = process.argv[2]
if (!src || !existsSync(src)) { console.error('usage: node build-release.mjs <path-to-portable.exe>'); process.exit(1) }
const name = basename(src)
copyFileSync(src, join('releases', name))
const sha = createHash('sha256').update(readFileSync(join('releases', name))).digest('hex')
const version = name.match(/(\d+\.\d+\.\d+)/)[1]
writeFileSync('release.json', JSON.stringify({ file: name, version, sha256: sha, sizeBytes: readFileSync(join('releases', name)).length }, null, 2) + '\n')
console.log('release.json written:', name, sha)
```
Verificação: rodar o script → `release.json written: goonMatch-Grid-1.0.1-portable.exe <64-hex>`; `node -e "const{createHash}=require('crypto'),f=require('fs');console.log(createHash('sha256').update(f.readFileSync('site/releases/'+JSON.parse(f.readFileSync('site/release.json')).file)).digest('hex'))"` → MESMO hex. Commit. (`.gitignore`: adicionar `site/releases/*.exe` — binário de 114MB NÃO entra no git; o Pages workflow baixa do GitHub Release, L3.)

### L1.4 Template `index.html` — corpo integral (copy-paste pronto; PT-BR, sem CSS)
Create `site/index.html`:

```html
<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>goonMatch Grid — rede P2P adulta com criptografia de ponta a ponta</title>
<meta name="description" content="Aplicativo Windows (arquivo único) para rede social e jogos de cartas entre adultos. Todo conteúdo é criptografado entre você e o destinatário: o servidor não lê nada. Baixe, verifique o hash e rode.">
</head>
<body>
<header>
<h1>goonMatch Grid</h1>
<p><strong>Conteúdo adulto: somente maiores de 18 anos.</strong> Ao baixar e usar, você declara ser maior de idade na sua jurisdição.</p>
<nav aria-label="Seções">
<a href="#o-que-e">O que é</a> ·
<a href="#seguranca">Segurança</a> ·
<a href="#criptografia">Criptografia</a> ·
<a href="#download">Download</a> ·
<a href="#verificar">Verificar o arquivo</a> ·
<a href="#termos">Termos de Serviço</a> ·
<a href="#privacidade">Privacidade</a> ·
<a href="en.html">English</a>
</nav>
</header>

<main>
<section id="o-que-e">
<h2>O que é este aplicativo</h2>
<p>goonMatch Grid é um programa para Windows (um único arquivo <code>.exe</code>, sem instalação) que funciona como uma rede social + arcade de jogos de cartas para adultos. Ele reúne:</p>
<ul>
<li>Feed com fotos/vídeos que VOCÊ publica e escolhe com quem compartilha;</li>
<li>Chat privado e salas de grupo com criptografia de ponta a ponta;</li>
<li>Um idle-clicker adulto e um jogo de cartas 1v1 com baralhos, loja interna e mercado entre jogadores;</li>
<li>Moderação por denúncia: quem recebe uma mensagem ofensiva pode denunciar e, só então, revelar a mensagem ao moderador.</li>
</ul>
<p>Não há cadastro, e-mail ou telefone. Sua "conta" é um par de chaves criptográficas gerado no seu computador. Você é o único responsável por guardar a chave secreta (o app oferece cópia de segurança em arquivo).</p>
</section>

<section id="seguranca">
<h2>Segurança: o que o servidor pode e não pode ver</h2>
<p>O servidor desta página hospeda apenas o download e um "correio" mínimo. Por design (auditado — veja os links abaixo):</p>
<ul>
<li>Todo conteúdo (mensagens, fotos, legendas, salas) viaja <strong>cifrado</strong>. O servidor encaminha envelopes opacos endereçados a tokens: ele não sabe quem envia, para quem, nem o que contém.</li>
<li>O servidor <strong>não mantém lista de quem está online</strong>: conexões são anônimas; presença existe apenas entre os seus contatos.</li>
<li>Nada é armazenado em cache no seu disco pelo app: imagens do feed vivem só na memória da sessão; toda resposta do servidor vem marcada <code>no-store</code>.</li>
<li>Suas chaves privadas ficam no seu Windows protegidas pelo cripto-sistema do próprio Windows (DPAPI) — nunca em texto puro, nunca no servidor.</li>
<li>Endereços IP não são registrados em logs de aplicação; o relay TURN usa credenciais temporárias aleatórias, sem ligação com sua identidade.</li>
<li>Você também pode não usar nosso servidor: o app aceita apontar para um servidor próprio (self-host), mantendo tudo dentro da sua rede.</li>
</ul>
<p>Leia o relatório completo de segurança: <a href="legal/security.html">Auditoria de segurança</a>. O código é aberto: <a href="https://github.com/9matesu/goongrid">github.com/9matesu/goongrid</a>.</p>
</section>

<section id="criptografia">
<h2>Criptografia e funcionamento (sem mistério)</h2>
<ul>
<li><strong>Identidade:</strong> ao iniciar, o app gera dois pares de chaves — Ed25519 (para assinar suas ações) e X25519 (para cifrar conteúdo). O seu "ID" é um resumo criptográfico (SHA-256) da chave pública. A chave privada nunca sai do seu dispositivo.</li>
<li><strong>Mensagens 1:1:</strong> criptografia ECIES (X25519 + BLAKE3 + XChaCha20-Poly1305). Matematicamente, só quem tem a sua chave privada abre o que te enviaram — nem o servidor, nem o autor depois.</li>
<li><strong>Salas de grupo:</strong> um segredo compartilhado (DEK) circula cifrado de convidado em convidado; quando alguém sai, o segredo é trocado (epoch) e o que foi dito antes continua legível, mas nada novo abre com a chave antiga.</li>
<li><strong>Autenticação de pedidos:</strong> toda chamada à API vem assinada e carimbadada no tempo; reuso de requisição (replay) é rejeitado.</li>
<li><strong>Privacidade no P2P:</strong> candidatos ICE com IP literal são descartados antes de sair do app; o relay é opcional e rotulado aleatoriamente.</li>
<li><strong>Limite honesto:</strong> criptografia protege conteúdo contra terceiros; NÃO protege contra alguém que roube seu computador desbloqueado ou sua chave exportada. Guarde a cópia da chave em lugar seguro.</li>
</ul>
</section>

<section id="download">
<h2>Download (Windows x64, arquivo único)</h2>
<p>Versão <strong>1.0.1</strong> · arquivo <code>goonMatch-Grid-1.0.1-portable.exe</code> · 114 MB ·</p>
<p><a href="releases/goonMatch-Grid-1.0.1-portable.exe" download>Baixar goonMatch-Grid-1.0.1-portable.exe</a></p>
<p>SHA-256 esperado (copie o valor abaixo e confira com o passo a passo da próxima seção):</p>
<pre id="sha256">0000000000000000000000000000000000000000000000000000000000000000</pre>
<p><em>(O hash real é publicado automaticamente na página e em <code>release.json</code> a cada release.)</em></p>
<h3>"O Windows disse que pode ser perigo" — por que e o que fazer</h3>
<p>O aviso <strong>SmartScreen</strong> aparece para QUALQUER programa legítimo não-assinado — não indica vírus. Este executável não tem assinatura comercial (custa centenas de dólares por ano e pagamos com doação, não com venda de dados). Para confiar de forma independente:</p>
<ol>
<li>Verifique o SHA-256 (abaixo) — prova que o arquivo baixado é exatamente o que publicamos;</li>
<li>Cole o hash ou envie o arquivo para análise no <a href="https://www.virustotal.com">VirusTotal</a> (verificação pública por ~70 antivírus);</li>
<li>Ou não baixe o .exe: clone o código aberto e compile você mesmo: <a href="https://github.com/9matesu/goongrid">github.com/9matesu/goongrid</a> (comandos em <code>README.md</code> — <code>npm install</code>, <code>npm run dist</code>).</li>
</ol>
</section>

<section id="verificar">
<h2>Verificar o hash no Windows (20 segundos, sem instalar nada)</h2>
<p>Abra o menu Iniciar, digite <code>PowerShell</code>, abra e rode (ajuste o caminho se salvou em outro lugar):</p>
<pre>Get-FileHash "$env:USERPROFILE\Downloads\goonMatch-Grid-1.0.1-portable.exe" -Algorithm SHA256</pre>
<p>Compare o valor <code>Hash</code> com o publicado acima. Se diferir em UM caractere, NÃO execute: apague e reporte em <a href="https://github.com/9matesu/goongrid/issues">github.com/9matesu/goongrid/issues</a>.</p>
</section>

<section id="termos">
<h2>Termos de Serviço e Privacidade (todos os documentos)</h2>
<ul>
<li><a href="legal/terms.html">Termos de Serviço</a> — elegibilidade (18+), chaves autocustodadas, conduta proibida, responsabilidade por conteúdo, encerramento.</li>
<li><a href="legal/privacy.html">Política de Privacidade (LGPD)</a> — exatamente quais dados existem, base legal, seus direitos (art. 18) e como exercê-los.</li>
<li><a href="legal/community.html">Regras da comunidade</a> — o que é bloqueado tecnicamente pelo app.</li>
<li><a href="legal/abuse.html">Denúncias e abuso</a> — como reportar conteúdo e como funciona a revelação opcional para moderação.</li>
<li><a href="legal/records.html">Registros de conteúdo adulto</a> — quem é o publisher das suas mídias (você) e o que isso significa.</li>
<li><a href="legal/e2e.html">Aviso sobre criptografia e autocustódia</a> — limites do que podemos fazer por você.</li>
</ul>
<p>Versão vigente destes documentos: <code>2026-09-09.1</code>. Alterações são registradas em <a href="legal/changelog.html">legal/changelog.html</a>. Dentro do app (Settings → Legal), o usuário logado lê e confirma aceite da versão vigente.</p>
</section>

<section id="faq">
<h2>Perguntas que você faria</h2>
<h3>Por que um .exe em vez de um site?</h3><p>Para que o conteúdo adulto nunca passe nem fique em um servidor web de terceiros: o app roda na sua máquina e só trafega envelope cifrado. Um site comum não tem como esconder do hospedeiro o que ele mostra.</p>
<h3>Posso recuperar minha conta se perder a chave?</h3><p>Não — e isso é proposital (ninguém, nem nós, entra na sua conta). Por isso o app obriga backup/export da chave.</p>
<h3>Tem telemetria, anúncios, cadastro?</h3><p>Não. Zero analytics, zero cookies na página, zero cadastro.</p>
<h3>O que o servidor guarda mesmo?</h3><p>No modo oficial: envelopes cifrados com prazo de expiração (até 7 dias até o destinatário buscar) e um token de entrega que é um resumo matemático da chave pública do destinatário. Nada que aponte a uma pessoa.</p>
</section>
</main>

<footer>
<p>Contato: <a href="https://github.com/9matesu/goongrid/issues">github.com/9matesu/goongrid/issues</a> · Código: <a href="https://github.com/9matesu/goongrid">MIT/ver LICENSE no repositório</a> · Esta página não usa JavaScript, CSS, fontes externas, cookies ou analytics.</p>
</footer>
</body>
</html>
```
**Nota do implementador:** o bloco do hash é preenchido pelo CI (L3.2) — em dev, rode `node build-release.mjs … && node sync-hash.mjs` (L1.5).
Gate: `node site/check.mjs` ainda falha (falta en.html/legal/*) — esperado.

### L1.5 `site/sync-hash.mjs` (~5 min)
Reescreve a linha `<pre id="sha256">…</pre>` do `index.html`/`en.html` com o `release.json` atual (regex replace, idempotente). Verificação: rodar → `node site/check.mjs` não reclama do hash. Commit `feat(site): plain-text landing PT + hash sync`.

---

## Phase L2 — Espelho EN + páginas legais

### L2.1 `site/en.html` (~10 min): mesma estrutura do L1.4 traduzida (PT é a fonte; EN é espelho — o `check.mjs` exige as mesmas ids de seção: adicionar teste `['what-it-is','security','crypto','download','verify','terms','privacy']`).
### L2.2 Páginas legais (~15 min): gerar `site/legal/{terms,privacy,community,abuse,records,e2e,changelog,security}.html` de `public/legal/*.md` (fonte canônico do plano jurídico 2026-09-09_034247 Phase C) com um `site/build-legal.mjs` mínimo (markdown→`<p>/<h2>/<ul>` com escape, ~40 linhas, SEM parser de terceiros). Cada página legal: título, versão, data, link de contato, hrefs só allowlisted. Verificação: `node site/check.mjs` → `OK`. 1 commit: `feat(site): EN mirror + legal pages generated from canonical source`.

---

## Phase L3 — Deploy no GitHub Pages com o binário do Release

### L3.1 Workflow de build do site (~15 min)
Create `.github/workflows/deploy-site.yml` (template Pages standard):

```yaml
name: Deploy site
on:
  push: { branches: [main], paths: ['site/**', '.github/workflows/deploy-site.yml'] }
  release: { types: [published] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Fetch latest release exe (if missing locally)
        env: { GH_TOKEN: ${{ github.token }} }
        run: |
          cd site
          V=$(node -e "try{console.log(require('./release.json').version)}catch{console.log(require('fs').readdirSync('../apps/desktop/release').filter(f=>f.endsWith('.exe')).sort().pop().match(/\\d+\\.\\d+\\.\\d+/)[0])}")
          F="goonMatch-Grid-$V-portable.exe"
          [ -f "releases/$F" ] || gh release download "v$V" -p "$F" -D releases/ || echo "WARN: exe not in releases/ — publishing text-only (hash section will say so)"
      - run: cd site && node build-release.mjs "releases/$(ls releases | grep -m1 'portable.exe')" && node sync-hash.mjs
      - run: cd site && node build-legal.mjs && node check.mjs   # O GATE BLOQUEIA O DEPLOY SE A PÁGINA MENTIR
      - uses: actions/upload-pages-artifact@v3
        with: { path: site }
  deploy:
    needs: build
    permissions: { pages: write, id-token: write }
    environment: { name: github-pages, url: ${{ steps.out.outputs.url }} }
    runs-on: ubuntu-latest
    steps:
      - id: out
        uses: actions/deploy-pages@v4
```
Pré-requisito manual (uma vez): Settings → Pages → Source = GitHub Actions. Verificação: push da branch → Actions roda → `curl -s https://<user>.github.io/goongrid/ | grep -c 'id="sha256"'` → `1`.

### L3.2 Ligação com o release do exe (~10 min)
O workflow `release.yml` existente (1.0.1) já sobe o portable.exe no GitHub Release; o deploy-site o baixa por `gh release download v<versão>` — a MESMA origem do download público (sem bucket de terceiros). Adicionar ao body do release (edit em `.github/workflows/release.yml`, campo `body`): uma linha `SHA-256: $(sha256sum do artefato)` calculada no step (comando: `sha256sum apps/desktop/release/*.exe | cut -d' ' -f1 | tee /dev/stderr >> $GITHUB_STEP_SUMMARY`).

### L3.3 Link a landing a partir do app (~5 min, read-only de UI)
`SidebarNav.tsx` não ganha nada novo; o único ponto: no rodapé do `LegalCenter` (plano jurídico) um link "página pública: <url do Pages>" — registrar aqui para não divergir: adicionar ao primeiro doc legal `changelog.html` a linha "Landing: https://…".

---

## Gate de validação (rodar na ordem, TODOS devem passar)

| # | Comando (cwd /i/goongrid) | Esperado |
|---|---|---|
| V1 | `node site/build-release.mjs apps/desktop/release/goonMatch-Grid-1.0.1-portable.exe` | `release.json written: …exe <64-hex>` |
| V2 | `node site/sync-hash.mjs && node site/build-legal.mjs && node site/check.mjs` | `OK` (exit 0) |
| V3 | `npm run lint && npm run test` | 0 erros lint; todos testes verdes (nada do app mudou — prova que a landing não arrasta CI) |
| V4 | `npx playwright test` | 12 passed |
| V5 | Local: `python -m http.server -d site 8090` + abrir `http://localhost:8090/index.html` | render sem CSS; download funciona; hash confere com `Get-FileHash` (instrução PT na página) |
| V6 | `grep -rnE 'src="https?:' site/*.html site/legal/*.html | grep -vE 'github.com/9matesu/goongrid|virustotal.com'` | VAZIO (sem tracker/fonte externa) |
| V7 | `grep -c 'script' site/index.html` (contando tags `<script`) | 0 (JS só existe nos *.mjs de build, NUNCA no site publicado) |

## Riscos / tradeoffs / aberto

1. **Pages não hospeda binários grandes** — 114MB no Pages artifact é na prática arriscado (limites de artifact). Plano B (documentado no L3.1 fallback): linkar o **GitHub Release** direto (`releases/latest/download/...exe`) — mesma plataforma que o código; o `check.mjs` então valida `release.url` como origem e o hash publicado é o que o CI calculou do release (mantendo o step de download+sha). Decidir ao ativar o workflow; a landing funciona com qualquer um dos dois — é trocar o `href`.
2. **Sem assinatura Authenticode**: SmartScreen vai avisar. A página transforma isso em força com 3 caminhos independentes de verificação (hash, VT, build próprio); não "resolver" isso escondendo.
3. **VT falso-positivo de empacotador**: electron-builder portable + bun.exe pode pontuar em 1-2 engines. Se ocorrer, documentar na página (adicionar `id="vt"`, re-rodar check.mjs) e pedir whitelist à engine — não remover o link VT.
4. **DRY jurídico**: as páginas `legal/*.html` são GERADAS do fonte canônico; nunca editar à mão (o `build-legal.mjs` sobrescreve; o CI detecta drift com `git diff --exit-code site/legal/`).
5. Aberto: domínio próprio (ex: goongrid.dev) no futuro — a landing já é estática, só muda a URL canônica; adicionar `<link rel="canonical">` fica de fora (é metadata, não conteúdo — aceitável? NÃO: o check.mjs proíbe `<link>`; reavaliar regra 1 quando houver domínio).
6. **Promessa de "no-store"/DPAPI** na página só é verídica DEPOIS do plano de segurança (2026-09-09_034247) ser executado — este plano DEVE rodar depois dele, ou as seções seguranca/verificar precisam de nota "parcial" (o check.mjs não impede texto; a honestidade é do redator). Ordem: auditoria/segurança → legal → landing.

