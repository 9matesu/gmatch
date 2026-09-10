# gMatch — Auditoria de Segurança (static pentest)

**Escopo:** white-box do fonte na branch `security/audit-hardening` (base `feat/secure-p2p-phase1` @ `e9414ed`+), app desktop Electron + API Hono/Bun + `@orbit/crypto|protocol`. Não houve alvo deployed para teste dinâmico — toda afirmação abaixo cita código verificável; os comandos "Provar" reproduzem cada achado.

**Metodologia:** superfícies de persistência (disco, localStorage/LS leveldb, IndexedDB, cache Chromium, snapshot SQLite do servidor), transporte (REST assinado, WS swarm, WS correio, WebRTC/ICE, TURN), autenticação e controle de acesso, primitivas criptográficas e protocolo de envelope, modelo de ameaças (a) forense do disco do usuário, (b) malware user-level, (c) operador do servidor, (d) MITM de rede, (e) abuso do painel admin.

## Achados

| # | Sev | Finding | Provar | Status |
|---|---|---|---|---|
| F1 | ALTA | Cache de imagens adultas persistido **em disco plaintext**: `<userData>/image-cache/<fnv1a(url)>.<ext>` + `meta.json` (~150MB/250 arquivos LRU) + `feed-cache.json` (respostas de tag query, TTL 10min). | `grep -n "writeFileSync(path.join(cacheDir" apps/desktop/electron/imageCache.cjs` | ✅ fix B.1 — LRU **em memória** + migração destrutiva que apaga o cache antigo |
| F2 | ALTA | Objetos/mídias servidos com `Cache-Control: public, max-age=31536000, immutable` → Chromium cache em disco + intermediários. | `grep -rn "max-age=31536000" apps/api/src/routes/objects.ts` | ✅ fix B.2 — `no-store` em todas as respostas de conteúdo |
| F3 | ALTA | Chaves privadas da identidade (Ed25519 + X25519) em **localStorage plaintext** (`orbit_identity`). | `grep -n "orbit_identity" apps/desktop/src/hooks/useIdentity.ts`; sem `safeStorage` no repo. | ✅ fix B.3 — `safeStorage` (DPAPI) com migração destrutiva |
| F4 | MÉDIA | Admin PIN com **fallback hardcodado** (`ADMIN_PIN \|\| 'Ionwarehouse1'`), comparação em texto puro, sem lockout. | `grep -rn "Ionwarehouse1" apps/api/src/routes/admin.ts` | ✅ fix B.4 — sem env → admin 503; hash + lockout |
| F5 | MÉDIA | Modo LEGACY (full-node/self-host): DMs com AES-storage **do servidor** (ele decripta para entregar) — não é E2EE. No SITE oficial o inbox não existe (gate 404) e o caminho é o correio E2EE. | `apps/api/src/pm.ts:6,136` + `crypto.ts:7-16` | 📋 decisão de produto documentada (ver "Modelo por modo"); `e2e-disclaimer` explica ao usuário |
| F6 | MÉDIA | Faltava prova automatizada de que o modo SITE nunca toca as tabelas de conteúdo (o snapshot SQLite só existe p/ full-node). | novo `apps/api/src/site-blindness.test.ts` | ✅ fix B.6 — teste-verificação end-to-end |
| F7 | BAIXA | CSP `connect-src` com wildcards `*.workers.dev`/`*.fly.dev`; `style-src 'unsafe-inline'`. | `sed -n 24-27p apps/api/src/middleware/security-headers.ts` | ✅ fix B.5 — origins exatos via `CSP_CONNECT_ORIGINS` (inline style mantido só em dev, documentado) |
| F8 | BAIXA | Threads/rooms courier e PFPs (data-URL) em localStorage plaintext. | `grep -n "orbit_mail_threads\|goonmatch_pfps" apps/desktop/src -r` | ✅ B.3 — secure KV (DPAPI) para todos os stores de conteúdo |
| F9 | BAIXA | (mesmo F8, pfp) | idem | ✅ |
| F10 | INFO | Signed-URLs de streaming com TTL 7h na query (`?sig&exp`) — risco de vazamento por histórico. | `grep -n "ttlSeconds" apps/api/src/crypto.ts` | ✅ fix B.7 — TTL 15min + single-use jti (replay/legacy-URL dead) |

## Controles verificados que JÁ existiam (positivos)

- **Auth:** assinatura Ed25519 `method|url|timestamp|nonce|body` em toda mutação; janela de timestamp; nonce-server + replay-block; `orbitId = sha256(pubkey)` re-hash server-side. `apps/api/src/middleware/auth.ts`.
- **Envelope v2 E2EE** (`packages/protocol/src/envelope.ts`): corpo + identidade do remetente DENTRO do seal; binding Ed25519 sobre `v2|kind|id|to|body` (anti-rebinding de kind/destinatário); X25519-ECIES + XChaCha20-Poly1305 + BLAKE3 KDF (13 testes).
- **Correio cego** (`apps/api/src/mail-store.ts`, `routes/mail.ts`): validação de FORMA apenas; bytes verbatim; ack só com prova de posse da chave (quem chuta token não apaga caixa alheia — teste com assinatura forjada); WS 100% anônimo (nenhum frame declara identidade); TTL + caps anti-flood.
- **TURN** (`routes/turn.ts`, `turn-creds.ts`): username `<rand16hex>:<exp>` — logs do relay NÃO ligam tráfego a identidade; HMAC auth-secret padrão coturn; sem creds → STUN-only sem hardcode de relay terceiro.
- **ICE hygiene** (`apps/desktop/src/utils/ice-hygiene.ts` + testes): candidatos host/srflx com IP literal descartados na origem dos dois stacks; só mDNS `.local` + relay.
- **SSRF guard** (`apps/api/src/proxy.ts:34`, `routes/objects.ts:128`): loopback/link-local/private ranges bloqueados no proxy de URL externa.
- **PII em logs** (`security-headers.ts: redactIp`): X-Forwarded-For/X-Real-IP redigidos.
- **X-Frame-Options DENY; Referrer-Policy no-referrer; COEP strict** (`security-headers.ts`).
- **At-rest AES-256-GCM** para blobs e PMs no full-node (dump do SQLite não entrega plaintext) — defesa em profundidade do F5.
- **Age gate 18+ inescapável** no primeiro run + **hard blocklist de tags** aplicada no main process (SPEC §8) — CSAM/incest/animals/non-consent etc. bloqueados na origem de toda requisição booru.
- **SITE_SERVICES** (`site-services.ts` + testes): no modo site, TODAS as rotas de conteúdo (pm, posts, objects, users, signal, lobby...) e o WS de swarm legado respondem 404 na borda.
- **Deleção de conta** (`users.delete('/account')`) e expiração de stories (12h) + limpeza periódica (`cleanup.ts`).
- **Sem telemetria**: nenhuma requisição de analytics no app; `grep -rn "analytics\|sentry\|beacon" apps/desktop/src` → 0.

## Ameaças modeladas → cobertura

| Ameaça | Mitigação no código |
|---|---|
| (a) Forense do disco do usuário | F1/F2/F3/F8 → runtime-only: imagens só em RAM, `no-store`, chaves e threads em DPAPI, `storage.key` local |
| (b) Malware user-level | DPAPI não ajuda (mesma sessão) — mitigado por: export de chave só via modal explícito + `will-prevent-unload` com aviso; limite honesto no ToS |
| (c) Operador do servidor | Correio cego + envelope sig + token público + TURN random + ICE hygiene + SITE gate: o host oficial NÃO vê conteúdo, identidade de conversa, presença, nem grafo. Full-node: o HOST É o servidor — `e2e-disclaimer` declara |
| (d) MITM de rede | TLS na API + payloads já E2EE; replay protegido por nonce/signature; CSP sem origens arbitrárias (F7 corrigido) |
| (e) Abuso de admin | PIN com hash + lockout + sem default (F4); unseal de conteúdo só via key-disclosure da vítima (plan courier P5, fase futura) |

## Modelo por modo (F5, decisão registrada)

- **SITE oficial (`SITE_SERVICES=mail,turn`)**: correio puro. O servidor é stateless para conteúdo (nenhuma tabela escrita; ver `site-blindness.test.ts`), guarda envelopes opacos por ≤7d e não sabe quem conecta.
- **Full-node self-host**: conveniência LAN/comunidade — o ADMINS-DO-HOST vê PMs/blobs com a chave dele, igual a qualquer servidor central histórico. Não é "o servidor deles", é o seu. ToS + disclaimer deixam isso explícito.

## Limitações / não-alcance

- Sem forward secrecy (X25519 estático por conta) — ratchet/prekeys ficam como hardening 1.x futuro.
- Sem onion-routing — correlação tráfego×tempo residual em qualquer correio (mitigada com padding/jitter no cliente; não eliminável).
- Auditoria é estática: não substitui pentest dinâmico por terceiros nem revisão de counsel humana para o jurídico.

## Checklist de runtime-only (como verificar hoje)

```bash
# 1) nada de imagem em disco após rodar o app:
ls "$APPDATA/@gmatch/desktop/image-cache" 2>/dev/null; echo "exit=$?"   # esperado: não existe / exit≠0
# 2) respostas sem cache:
curl -sI "$API_BASE/api/objects/<own-id>" | grep -i cache-control          # no-store
# 3) sem chave no localStorage:
#    (abrir DevTools do app) localStorage.getItem('orbit_identity')          # null
#    arquivo cifrado: <userData>/identity.bin (DPAPI)
# 4) admin sem env desabilitado: POST /api/admin/verify-pin → 503 sem ADMIN_PIN_HASH
```

## Rodada 2 (2026-09-09, v1.1+ / branch feat/encrypted-api-servers)

| # | Sev | Achado | Repro | Status |
|---|-----|--------|-------|--------|
| F11 | ALTA | Mutação assinada viajava com body JSON + headers em **texto puro** — qualquer MITM/observador da rede via corpo, path e a rota-alvo do usuário. | `grep -n "X-Orbit-Signature" apps/desktop/src/utils/api.ts` | ✅ fix T2 — ECIES para a X25519 key do nó (`GET /api/identity`), header `X-Orbit-Sealed`; body/headers legíveis só no nó (testes `packages/protocol/src/api-seal.test.ts`, `apps/api/src/middleware/unseal.test.ts`, `apps/desktop/src/utils/api.seal.test.ts`) |
| F12 | MÉDIA | Nenhum controle de acesso ao **criar/entrar** em servidores: qualquer key poderia poluir o diretório ou se fingir host. | novo `apps/api/src/routes/servers.test.ts` | ✅ T3 — registro exige orbitAuth Ed25519; hint de endpoint revelado só a chamados assinados; 5/max-dono; stale 24h |
| F13 | BAIXA | Userlist do nó exporia last_seen preciso. | `GET /api/servers/dashboard` anônimo | ✅ T4 — anônimo = só contagens; membros = id truncado (8) + boolean 60s |
| F14 | MÉDIA | Servidores privados sem senha = qualquer key descoberta podia escrever (orbitAuth auto-cria Users!). | novo `apps/api/src/routes/password.test.ts` | ✅ T5 — scrypt no SystemMeta do host + gate de escrita p/ newcomers (allowlist assinada, epoch grandfathered, lockout 5/15) |
| F15 | BAIXA | Handoff de servidor sem mecanismo seguro de backup. | novo `apps/api/src/routes/snapshot.test.ts` | ✅ T6 — `/api/snapshot` admin-only, allowlist de conteúdo, nunca exporta SystemMeta/Sessions/ServerDirectory |

Pendências honestas da rodada 2: replicação automática multi-réplica NÃO
implementada (export/import manual cobre v1; ver ADR-002). Kill-switch
`API_SEALED_ONLY` ainda aceita legado assinado (mitigação de suporte,
documentada). B.7 (signed URLs) permanece fechado na rodada 1.

## Rodada 3 (2026-09-10, v1.1.3+ / branch fix/logic-consistency-sweep)

| # | Sev | Achado | Repro | Status |
|---|-----|--------|-------|--------|
| F16 | ALTA | `idle-credit` aceitava QUALQUER inteiro 1..1M por throttle de 60s — a SPEC dizia ledger "autoritativo", mas a validação de taxa de ganho só existia no cliente (jogador mal-intencionado forjava g$ em nós compartilhados/federados; rankings viravam ficção). | histórico `economy-idle.ts` (sem gate) | ✅ envelope server-side: `idleEnvelope` = 1.5× taxa registrada × elapsed + 5 (claim com crescimento limitado 2x+100/crédito, teto 50k/s); primeiro flush pós-boot do nó é confiável por design. Testes `economy-idle.test.ts` (16). Escopo honesto: no SEU nó disciplina crashes; protege leaderboards alheios. |
| F17 | BAIXA | `buyCard` bloqueia auto-compra de listing próprio desde o scaffold (guard + teste existentes) — mas o StoreTab oferecia botão Buy ativo no próprio listing (403 confuso ao clicar). | `grep "own card" apps/api/src/cards.test.ts` | ✅ badge "Yours" no lugar do botão (UI honesta; server já estava certo). |
| F18 | MÉDIA | Debuffs de hack pagos viviam em ARRAY EM MEMÓRIA — reiniciar o sidecar (todo relaunch do app!) comia o efeito ativo da vítima e a sessão de spy-feed do atacante já cobrada em g$. | `grep -n "activeServerHacks" apps/api/src/routes/users.ts` (histórico) | ✅ tabela `HackDebuffs` (migração 048): INSERT via lote atômico do débito (gate `changes()`), prune/leituras via DB; cleanup de conta + allowlist de snapshot ligados. Teste "survives module re-init" (`spy-feed.test.ts`). |
| F19 | BAIXA | Ações de Domination nunca-acked (vítima fechou o app; câmera bloqueada pelo SO) ficavam `sent` para sempre — UI honesta ("awaiting") mas estado terminal inexistente. | `SELECT count(*) FROM DominationActions WHERE status='sent'` antigo | ✅ sweep 30min `sent→expired` no `deleteExpiredContent` (3d) + chips "fizzled/skipped" com explicação do reembolso-zero e nota no modal de câmera. |

Admin (refactor de privacidade, mesma semana): leitura em massa de DMs e
analytics de referrer REMOVIDAS do software; disclosure agora é report-scoped
(`GET /api/admin/cases/:id` — a linha "(e) key-disclosure fase futura" da
rodada 1 torna-se realidade implementada). Ledger completo em
`docs/ADMIN-SUITE.md`.
