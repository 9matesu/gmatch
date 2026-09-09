# goonMatch Grid — Auditoria de Segurança (pentest estático), Runtime-Only Privacy ("nada em cache, nada no servidor") e Blindagem Jurídica

> **Para a Hermes:** executar task-por-task com TDD (`test-driven-development`); cada task = RED → GREEN → `npm run lint` (0 err) → `npm run test` → commit. Branch: `security/audit-hardening` a partir de `feat/secure-p2p-phase1`.

**Goal:** Produzir o relatório de pentest (audit estático real do fonte — não há alvo deployed nesta máquina), eliminar TODO cache/persistência de conteúdo fora dos dois usuários (memória-only + criptografia at-rest via OS keychain), garantir que no modo SITE o servidor só vê endereços, e publicar o pacote jurídico completo (ToS/Privacidade/LGPD/2257/abuso) acessível ao usuário logado com aceite versionado.

**Repo:** `I:/goongrid`. Gates do repo: `npm run lint` (0 erros) · `npm run typecheck` · `npm run test` (api 759+, desktop 435+, protocol 15) · `cd apps/desktop && npx playwright test` (12).

---

## 1. Contexto atual — achados VERIFICADOS em código (pentest estático)

Sem servidor deployed acessível, o "pentest" aqui é white-box: cada linha cita arquivo/linha reais da vistoria desta sessão.

### 1.1 ACHADOS (findings)

| # | Sev | Finding | Evidência | Viola a meta? |
|---|---|---|---|---|
| F1 | **ALTA** | **Cache de imagens adulto em disco, plaintext**: todo booru/feed fetch é persistido em `<userData>/image-cache/<fnv1a(url)>.<ext>` (até ~150MB/250 arquivos LRU) + `meta.json` + `feed-cache.json` (respostas de query, TTL 10min). Sobrevive ao app, legível por qualquer processo do usuário/forense. | `apps/desktop/electron/imageCache.cjs:1-16,74-78,199` (`fs.writeFileSync(path.join(cacheDir, file), buf)`) | SIM — "sem cache png" |
| F2 | **ALTA** | **Mídias privadas servidas com cache HTTP imutável**: respostas de objeto levam `Cache-Control: public, max-age=31536000, immutable` — imagens/dm-blobs ficam no HTTP cache do Chromium (índexado em disco) e em qualquer cache intermediário. | `apps/api/src/routes/objects.ts:618,644,717` | SIM — "information on run time only" |
| F3 | **ALTA** | **Chaves privadas da identidade em localStorage plaintext** (`orbit_identity` = privateKeyHex + encryptionPrivHex). localStorage não é criptografado em disco no Electron/Chromium. Roubo = acesso total à conta e a TODAS as DMs E2EE históricas. | `apps/desktop/src/hooks/useIdentity.ts:51,88,124` (nenhum uso de `safeStorage` no repo — grep vazio) | SIM (pelo menos: proteger at-rest) |
| F4 | **MÉDIA** | **Admin PIN com fallback hardcodado**: `const expectedPin = c.env.ADMIN_PIN \|\| 'Ionwarehouse1'` — deploy sem env abre o painel admin com PIN público no fonte. Verificação em texto puro (sem hash, sem lockout, sem rate-limit específico). | `apps/api/src/routes/admin.ts:43` | SIM |
| F5 | **MÉDIA** | **DMs em modo LEGACY (self-host/full node) são líveis pelo servidor**: `pm.ts` usa `encryptText` = AES-256-GCM com `STORAGE_ENCRYPTION_KEY` do PRÓPRIO servidor — ele decripta para entregar. Não é E2EE. (O caminho courier/E2EE existe, mas só domina no modo SITE.) | `apps/api/src/pm.ts:6,136` + `crypto.ts:7-16` | SIM no modo legacy — documentar/decidir (ver §3) |
| F6 | **MÉDIA** | **DB snapshot do servidor guarda conteúdo legível além de endereços**: `orbit.snapshot.sqlite` contém caption/tags de posts, `display_name`, `last_seen`, `pfp_url`, e (no legacy) PMs. É OBRIGATÓRIO p/ full node, mas no SITE o gate já impede; falta PROVA automatizada de que o modo site não escreve tabela de conteúdo. | `apps/api/src/persistence.ts:38-54` (snapshot completo), gate `SITE_SERVICES` em `site-services.ts` | verificar c/ teste novo |
| F7 | **BAIXA** | **CSP com wildcards largos**: `connect-src ... https://*.workers.dev wss://*.workers.dev https://*.fly.dev` — aceita qualquer tenant do Cloudflare/Fly como destino de rede do renderer. `style-src 'unsafe-inline'` (mitigável). | `apps/api/src/middleware/security-headers.ts:24-27` | SIM (superfície) |
| F8 | **BAIXA** | **Threads de DM courier salvas em localStorage plaintext** (`orbit_mail_threads_v1`): texto em claro no disco do usuário (próprio dispositivo — aceitável sob "somente os dois usuários veem", mas quebra "runtime-only" e é lível por forense/malware simples). | `apps/desktop/src/utils/mail-dm.ts` (THREADS_KEY) | parcial |
| F9 | **BAIXA** | **PFPs como data-URLs em localStorage** (`goonmatch_pfps`) — imagens em claro no disco. | `apps/desktop/src/App.tsx:734,1629,1752,2768` | SIM |
| F10 | **INFO** | URLs assinadas `?sig&exp` (TTL 7h) para streaming de objetos: token na query pode vazar em logs/histórico. Já validado com HMAC + exp. | `apps/api/src/routes/objects.ts:492-526` | mitigável (TTL curto ok) |

### 1.2 CONTROLES POSITIVOS VERIFICADOS (o que já está certo — citar no relatório)

- **Assinatura de request Ed25519** (method|url|ts|nonce|body) + replay-nonce + janela de timestamp; orbitId = sha256(pubkey) verificado server-side. `apps/api/src/middleware/auth.ts:55-176`.
- **Envelope v2 E2EE**: corpo/identidade dentro do seal; binding sig `v2|kind|id|to|body` (anti-rebind); token = blake3(pubkey). `packages/protocol/src/envelope.ts` (13 testes).
- **Correio cego**: validação de FORMA apenas; conteúdo byte-verbatim; ack exige posse da chave; caps/TTL; WS anônimo. `apps/api/src/mail-store.ts`, `routes/mail.ts` (17+9 testes).
- **TURN efêmero**: username random (nunca orbitId), HMAC auth-secret, sem fallback de relay de terceiro; sem creds → STUN-only. `apps/api/src/turn-creds.ts`, `routes/turn.ts`.
- **ICE hygiene**: nenhum IP literal/srflx sai; only mDNS `.local` + relay. `apps/desktop/src/utils/ice-hygiene.ts` (+ `candidateLeaksIp`).
- **SSRF guard** no proxy (loopback/link-local/private blocklist) `apps/api/src/proxy.ts:34`; bloqueio de hosts privados em objects `:128`.
- **Redação de IP nos logs** (`redactIp`, security-headers.ts:29+); X-Frame-DENY; Referrer no-referrer; COEP strict.
- **AES-256-GCM at-rest para blobs/PMs no full-node** (defesa em profundidade — não E2EE, mas raw-DB-dump não expõe).
- **Gate SITE_SERVICES**: no modo site, /api/pm, posts, users, signal etc. 404 na borda. `site-services.test.ts` já lista as rotas mortas.
- **Delete account** (`users.delete('/account')` :762) e **expiração de stories** existem.
- **Age gate 18+** inescapável no primeiro run; **blocklist de tags** hard no main process (SPEC §8).

---

## 2. Arquitetura proposta

Três frentes: **(A) Relatório** `docs/SECURITY-AUDIT.md` gerado dos achados acima com evidências reproduzíveis; **(B) Runtime-only**: deletar o cache de disco (imagens viram LRU **em memória** no main process, servidas por `gooncache://` com buffers voláteis; `feed-cache.json` morre), `no-store` em toda resposta de objeto/mídia, chaves de identidade e threads de chat migradas para **`safeStorage` (DPAPI no Windows)** com blob cifrado at-rest, PFPs param de ir para localStorage; **(C) Jurídico**: pacote PT-BR+EN (ToS, Privacidade/LGPD, comunidade/abuso, exclusão de conteúdo, disclaimer E2EE + 2257-adjacente) renderizado num `LegalCenter` acessível ao logado (Settings → Legal), com aceite versionado persistido.

A regra de ouro para F5: **o site oficial roda exclusivamente em modo courier** (já gateado); o relatório documenta que self-host full-node tem inbox legível pelo admin-do-host (o usuário é o servidor) — decisão consciente, não bug.

---

## 3. Phase A — Relatório de pentest (documentos, sem código)

**A.1** Criar `docs/SECURITY-AUDIT.md` com: escopo (white-box do commit X), metodologia (strace-style: superfícies de persistência, transporte, auth, cripto, privacidade), tabela F1-F10 do §1.1 + §1.2, e um "reproduction command" por finding (ex.: `grep -n 'writeFileSync' apps/desktop/electron/imageCache.cjs`).
**A.2** Seção "Ameaças modeladas": (a) forense do disco do usuário, (b) malware user-level, (c) operador do servidor, (d) MITM rede, (e) abuso de admin — mapear qual achado serve a qual.
**A.3** Gate: `npm run lint` inalterado; commit `docs(security): static pentest report v1`.

---

## 4. Phase B — Runtime-only (código; TDD por task)

### B.1 Matar o cache de imagens em disco (F1) — LRU em memória no main process

- **RED** `apps/desktop/electron/imageCache.mem.test.cjs` (node, sem vitest-dom): novo módulo `imageCacheMemory.cjs` exportando `put(url, buf)`/`get(url)` com Map LRU (max 256MB via `maxBytes`, entry evictada = buffer dereferenciado); teste: put→get verbatim; evict por bytes; `get` não toca fs (`fs.writeFileSync` spy = 0 chamadas).
- **GREEN**: criar `apps/desktop/electron/imageCacheMemory.cjs` (Map + tamanho, ~60 linhas). Em `imageCache.cjs`: substituir o caminho de escrita/leitura em disco pelo mem-cache (`cacheImage()` baixa → `mem.put` → retorna `gooncache://m/<key>`; `serveImage()` lê do Map; **deletar** `feedPath`/`feed-cache.json` — cada fetch de tag vai à API; o TTL de 10min vira memória via mem-cache das responses). `clearCache()` → `mem.clear()`. Remover `fs.mkdirSync(cacheDir)` inteiros; adicionar migração destrutiva: no `init()`, `fs.rmSync(userDataPath/image-cache, {recursive: true, force: true})` + `fs.rmSync(feedPath,{force:true})` (apaga o cache antigo do disco de quem já rodou a v1).
- **Verificação**: `node -e` chamando init+cacheImage mock → asserção `!fs.existsSync(cacheDir)` pós-migração; grep-gate: `grep -n "writeFileSync(path.join(cacheDir" apps/desktop/electron/imageCache.cjs` → VAZIO. E2E offline card (journey "offline card shows and retry recovers") continua verde (fallback remoto ok).
- **Custo honesto** (relatório §risks): re-download de imagens a cada sessão = banda; aceitável pela meta.

### B.2 `no-store` em toda resposta de conteúdo (F2)

- **RED** `apps/api/src/routes/objects-nostore.test.ts`: GET `/api/objects/<id>` (owner) e `/api/babecock/.../content` → `Cache-Control` header === `no-store` (assert .not.toContain('immutable')).
- **GREEN**: `objects.ts:618,644,717` trocar por `headers.set('Cache-Control','no-store')` (+ `Pragma: no-cache`). Grep-gate pós: `grep -rn "max-age=31536000" apps/api/src` → VAZIO.
- Renderer: `apps/desktop/src/main.tsx`/`utils/api.ts` garantir `fetch(url, {cache:'no-store'})` default para GETs de objeto (helper `objectFetch`).

### B.3 Chaves de identidade via safeStorage (F3) + threads/PFPs (F8,F9)

- **Main**: preload expõe `window.orbitSecure = { save(json), load(), clear() }` via IPC: `safeStorage.encryptString` → `<userData>/identity.bin` (DPAPI Windows). Fallback (sem safeStorage): reusar `storage.key` auto-gerado (AES-256-GCM, mesma rotina de `apiSidecar.cjs:35-49`).
- **RED** `apps/desktop/src/hooks/useIdentity.secure.test.ts`: `createIdentity` chama `orbitSecure.save` (mock) e localStorage NÃO contém `privateKeyHex` (assert `!localStorage.getItem('orbit_identity')?.includes('privateKey')`); load decifra via mock.
- **GREEN**: `useIdentity.ts` — migrate-on-first-run: se `orbit_identity` existe em LS → save via secure + `removeItem` (migração destrutiva); thereafter read/write secure apenas.
- **Threads courier (F8)**: `DmStore` (mail-dm.ts) — trocar o storage backend por interface `KvStore` (`get/set`); implementação Electron: `orbitSecure.kvSet(key, json)` (mesmo AES); browser/dev: LS com prefixo e um aviso no relatório. Mesma troca em `orbit_rooms_v1`, `orbit_room_messages_v1`, `goonmatch_pfps` (PFP: guardar só data-URL no secure-kv, nunca LS).
- Testes de migração: pré-semear LS com chave fake → rodar load → assert LS vazio e secure-mock contém.

### B.4 Admin PIN: sem fallback, hash + lockout (F4)

- **RED** `admin.test.ts` novo caso: `env.ADMIN_PIN` undefined → `POST /verify-pin` responde **503 `{error:'admin disabled'}`** (NUNCA aceita PIN default); 5 erros seguidos de um orbitId → 429 cooldown 15min (clock injetável).
- **GREEN**: `admin.ts:35-59` — `const expectedHash = c.env.ADMIN_PIN_HASH`; ausente → 503; comparar com `timingSafeEqual` de sha256(pin); mapa in-memory `pinFail: Map<orbitId,{n,until}>`. `apiSidecar`/`.env.example` documentam `ADMIN_PIN_HASH=$(printf %s PIN | ...sha256)`. Adicionar migration note: quem dependia do fallback precisa setar env (aceitável — release novo).
- Grep-gate: `grep -rn "Ionwarehouse1" apps/ packages/` → VAZIO.

### B.5 CSP estrita (F7)

- **GREEN direto** (config): `security-headers.ts` — remover `*.workers.dev`/`*.fly.dev` do connect-src e substituir por lista de ORIGIN exata do deploy (env `CSP_CONNECT_ORIGINS`); tentar tirar `style-src unsafe-inline` (se Vite/Tailwind runtime-inject quebrar, documentar exceção no relatório — provável em dev; manter `unsafe-inline` só em dev). Teste: `security-headers.test.ts` asserta header final sem wildcard quando env presente.

### B.6 Prova do site cego (F6) — teste end-to-end de modo site

- **RED+GREEN juntos** (é o gate da feature): novo `apps/api/src/site-blindness.test.ts`: boot do `serve.ts` com `SITE_SERVICES=mail,turn` (usar `Bun.spawn`? NÃO — harness `createMockEnv` + app Hono): (1) PUT ` /api/posts`/`/api/pm` → 404; (2) depois de 20 envelopes mail PUTados, **scan do store in-memory e de um snapshot simulado** não contém nenhum `sealed` decodificado — assert trivial: mail-store guarda só `{to,id,sealed}`; e (3) **DB do site**: as tabelas Users/Posts/PM nunca têm linha porque as rotas morrem — assert `SELECT count(*)` zero após tráfego courier. Comentar no teste: "in site mode the DB is never touched by mail/turn — stateless relay".
- Rodar `npm run test` → verde. Este arquivo É a evidência reproduzível do relatório §F6.

### B.7 TTL das signed-urls 7h→15min + nonce no stream (F10)

- `crypto.ts:71-74` default `ttlSeconds = 900`; `routes/objects.ts` stream: aceitar `sig` só via **header** `X-Orbit-Sig` (manter query p/ compat por 1 release com warning no log? não —<3 releases, breaking ok p/ exe novo; `<img src>` não manda headers → manter query mas exigir `&n=<once>` single-use: mapa de nonces LRU 10k).
- Teste: reuso da mesma url assinada → 403.

---

## 5. Phase C — Blindagem jurídica + UI Legal

### C.1 Conteúdo canônico versionado

- Criar `apps/desktop/src/legal/documents.ts`: objeto `LEGAL_DOCS: Record<LegalId, {title, version: '2026-09-01.1', body: string[]}>` com 6 documentos em **PT-BR** (idioma do usuário) + chaves EN no mesmo shape (`legal/documents.en.ts`):
  1. `terms` (ToS): elegibilidade 18+, licenças, contas anônimas/autocustódia ("suas chaves, sua conta — recuperação impossível sem backup"), conduta, limites de liability, encerramento, change-log com aceite.
  2. `privacy` (LGPD + GDPR): controlador (o projeto), base legal, dados tratados (ENCONTRADOS NO AUDIT: no site = delivery tokens, timestamps, saldos; em full-node o host é co-controlador dos dados dele), **data-minimization statement** espelhando o §1 relatório (no-store, mem-cache, keys em DPAPI), direitos (art. 18 LGPD) com rota de exercício, DPO-contato placeholder do repo, retenção (TTL courier 7d, delete-account), cookies: nenhum.
  3. `community` (regras + blocklist §8 citada nominalmente como regra técnica client-side).
  4. `abuse` (DMCA-ish/notice-and-takedown + reporte on-demand com key-disclosure; "não podemos remover do que não lemos" — honestidade E2EE).
  5. `adult-content-records` (2257-adjacente): declaração de que o USUÁRIO é o publisher/records custodian, plataforma sem controle editorial em modo courier; age-gate evidenciado.
  6. `e2e-disclaimer`: explicação de autocustódia, TOFU, o que o servidor NUNCA vê (conteúdo, presença, grafo), o que um FULL-NODE ADMIN vê (metadados+PMs legacy) — espelha F5.
- Teste `legal/documents.test.ts`: cada doc tem version ISO, ≥8 seções, campo `jurisdiction` presente, EN e PT mesmo nº de chaves.

### C.2 Aceite versionado do usuário logado

- **RED**: `App.tsx` — usuário logado sem aceite da versão atual: banner persistente "Leia e aceite os Termos" → modal; aceite grava `orbit_legal_accepted = version` em LS + POST `/api/users/legal-accept` (full-node; 404-silent no courier).
- **GREEN**: `components/LegalCenter.tsx` (modal full: nav lateral de 6 docs, TOC, "last updated", botão Aceitar/Impresso→download .md) + hook `useLegalGate`. Botões "Terms"/"Privacy" já existentes (AgeGate, `onOpenTos`) abrem o LegalCenter na doc certa (substitui `TosModal.tsx` — deletar, conteúdo absorvido com diffs citados no commit).
- Verificação: RTL — banner some após aceite; versão bumpada re-solicita.

### C.3 Acessibilidade do jurídico

- Rota `#/legal/<doc>` (alias p/ quem sai do app) renderiza LegalCenter; **download** dos docs (arquivos .md em `public/legal/` gerados do mesmo fonte por `scripts/gen-legal.mjs` — fonte único, sem drift). Site público pode linkar os .md sem logar (obrigação legal).
- Teste do script: gerar → diff com os .ts (byte-estável) → CI gate `node apps/desktop/scripts/gen-legal.mjs && git diff --exit-code public/legal/`.

### C.4 README/docs

- `docs/SECURITY.md` aponta para SECURITY-AUDIT; rodapé do README: "This software is self-hosted/P2P; the distributors assume no editorial liability — see Legal Center." Commit final `docs(legal): LGPD/2257-adjacent package + in-app Legal Center`.

---

## 6. Validação final

| Gate | Comando | Esperado |
|---|---|---|
| Unit | `npm run test` | api 759+, desktop 435+, protocol 15, + novos (mem-cache, secure-kv, admin, csp, blindness, legal, signed-nonce) |
| E2E | `cd apps/desktop && npx playwright test` | 12 passed |
| grep-gates B | §B.1-4 acima | todos VAZIOS |
| Disco limpo pós-run | iniciar `npm run electron` → fechar → `ls "$APPDATA/goongrid/image-cache" 2>/dev/null` | diretório inexistente |
| no-store | `curl -sI $API/api/objects/<own-id> \| grep -i cache-control` | `no-store` |
| DPAPI | `strings "$APPDATA/@goongrid/desktop/Local Storage/leveldb"/* \| grep -c privateKeyHex` | 0 |

## 7. Riscos / tradeoffs / aberto

1. **Banda/latência** pós-B1 (sem cache de imagem): imagens do feed re-baixam; mitigação: manter os `blob:` URLs da sessão viva (já são) — só a travessia de sessão some.
2. **safeStorage = DPAPI**: protege contra forense de outro usuário/backup, NÃO contra malware rodando como o usuário (esse lê o processo). Documentar no ToS (onibus honesto, não overpromise).
3. **Legacy inbox (F5) é decisão de produto, não bug**: full-node ≠ courier; o relatório + `e2e-disclaimer` dizem. "Sempre courier" derrubaria self-host — NÃO fazer sem pedido.
4. **Quebras de contrato**: B4 (sem ADMIN_PIN → admin desabilitado) e B7 (single-use sig) mudam comportamento — changelog + nota no LegalCenter change-log.
5. **LGPD controlador**: nome/Razão social/contato do responsável real precisa ser preenchido pelo usuário no C.1 (placeholders marcados `TODO(legal-owner)` — bloqueante p/ produção oficial, não p/ merge do PR).
6. Jurisdicion: PT-BR/BR como primário (usuário BR); EN secundário; sem counsel humana — o plano não substitui revisão por advogado (declarado no rodapé do próprio doc).

