# goonMatch Grid — P2P estilo Session/SimpleX: site-only TURN/STUN + encontro criptografado de peers + moderação on-demand

> **For Hermes:** executar task-by-task com TDD (skill `test-driven-development`); cada task = branch → RED → GREEN → `npm run lint` (0 err) → `npm run test` → commit.

**LEI FUNDAMENTAL (regras do usuário, não-negociáveis, cumulativas):**
1. Nenhuma informação além dos **endereços** passa pelo servidor. A troca de conteúdo é exclusivamente **client-to-client** (WebRTC DataChannel E2EE; TURN/STUN do site = relay de bytes DTLS já cifrados, nunca legíveis).
2. O servidor **somente encaminha endereços — nunca sabe quem entra ou sai**. Consequência de design: o servidor não vê presença online/offline, não associa identidade↔conexão, e não mantém roster "de quem está aqui". Ele é um **correio cego por endereço** (estilo SimpleX: sem registro de usuário; estilo Session: sem "online" no servidor).

**Goal:** o website que hospeda o .exe é o único servidor (correio de envelopes por endereço + STUN/TURN); peers se encontram e conversam sempre cifrados, client-to-client, com salas estilo Ares Galaxy; o admin opera na interseção dos endereços apenas via **divulgação de chaves pelo próprio usuário** (moderação on-demand), nunca como leitor passivo, intermediário de dados, ou observador de presença.

**Repo:** `I:/goongrid` (v1.0.x). **Stack:** Electron renderer (React/TS), API Hono/Bun, `@orbit/crypto` (Ed25519 + x25519 + XChaCha20-Poly1305 + blake3 — primitivas E2EE JÁ EXISTEM: `encryptPayload/decryptPayload`, `generateDek`, `wrapDekForMultipleRecipients`, `encryptContent/decryptContent` chunked, `ContentManifest`), WS swarm (`apps/api/src/ws-bus.ts` + `apps/desktop/src/hooks/useP2P.ts`), PeerJS relay (`apps/desktop/src/utils/peer-relay.ts`), WebRTC file-transfer (`apps/desktop/src/utils/webrtc.ts`, signaling REST `/api/signal/*`), ICE hygiene (`apps/desktop/src/utils/ice-hygiene.ts` — `sanitizeCandidate`/`candidateLeaksIp`, sem IP literal/srflx onward).

---

## 1. Estado atual (verificado em código)

| Peça | Hoje | Conflito com a Lei |
|---|---|---|
| Identidade | `OrbitIdentity`: Ed25519 (assinatura) + x25519 (`encryptionPubHex/PrivHex`) | nada — base pronta |
| Swarm WS (`/api/ws`, sala `global`) | relaya JSON **plaintext** (conteúdo) p/ todos; **sabe quem conectou/desconectou** (`conns` map `orbitId→conn`, presença broadcast) | viola 1 (conteúdo) e 2 (presença) |
| PeerJS (`peer-relay.ts`) | payloads P2P, mas signaling na nuvem pública `0.peerjs.com` | viola "site único" |
| WebRTC file-transfer (`webrtc.ts`) | DataChannel E2EE direto; signaling REST `/api/signal/*` guarda offer/answer/ICE no servidor | roteamento correto, mas violação de 2: `/api/signal/pending` associa identidade↔conta no servidor; sinais em claro |
| Roster `/api/users/online` | lista de quem está ONLINE (id+nome) | viola 2 frontalmente |
| DMs (`pm.ts`) | inbox server-side, AES-storage do servidor (ele decripta p/ entregar) | viola 1 |
| Blobs/feed | `encryptBlob` STORAGE do servidor (legível por ele); legendas plaintext | viola 1 |
| TURN | opt-in env | falta emissão efêmera pelo site |

## 2. Arquitetura-alvo — correio cego por endereço

```
        [SITE = único servidor]  — NÃO sabe quem entra/sai, NÃO lê conteúdo
         ├─ estáticos: landing + download .exe
         ├─ CORREIO WS: recebe envelope opaco endereçado a um HANDLE,
         │   entrega quando (e se) UMA CONEXÃO portadora daquele handle
         │   aparecer. Conexões não declaram quem são; o vínculo
         │   handle↔conexão existe só na cabeça do cliente.
         ├─ STUN/TURN (coturn use-auth-secret) — relay de bytes cifrados
         └─ admin ops: recebe relatórios com KEY DISCLOSURE assinada,
             via o próprio correio (endereçado ao handle do admin)
```

Mecanismos que implementam a Lei 2:

1. **Handles de conexão = tokens descartáveis, nunca a identidade.** Cada sessão abre N conexões WS com `handle` aleatório (256-bit, girado a cada reconexão e periodicamente). O envelope carrega `to_handle` — mas o **destinatário real** só existe dentro do `sealed`: o envelope é endereçado *cifradamente* (a quem abrir). O servidor roteia por uma **tabela de entrega que ele próprio não entende**: o `to` público é um *delivery token* derivado do estado que SÓ o dono e o remetente conhecem (ver 2. abaixo) — p/ o servidor é bytes aleatórios iguais p/ qualquer usuário.
2. **Delivery token = hash unilateral.** Remetente quer entregar p/ X: token = `blake3(X_encPub || local_epoch_de_X)`; X publica seu estado de epoch via envelopes-signados que trafegam pelo correio; a troca de epoch é client-side. O servidor acumula apenas `token→conexão` onde token muda a cada reconexão — correlacionar "mesma pessoa em dois momentos" exige a state de epoch que só os pares têm. (Simplificação aceitável p/ 1.1: token = `blake3(session_secret_da_conexão)`; conexões são anônimas e voluntárias — ninguém "aparece online" p/ o servidor; presença é um *serviço dos peers*, não do servidor: os que têm sua chave/whisper recebem seus pings.)
3. **Sem roster de online no servidor.** `GET /api/users/online` sai do site: quem você conhece = sua lista local (peers importados/seguidos). Descoberta = você publica envelopes de "hello/invite" p/ handles específicos; seus contatos ecoam convites p/ cont deles (gossip entre clients, estilo Ares: lista de salas trocada de par em par, não do servidor).
4. **Correio = caixa de entrega, não caixa postal com nome.** Envelopes ficam retidos no servidor **opacos e com TTL curto** (ex.: 7d) endereçados só a um delivery-token; o destinatário puxa na reconexão com o token que ele mesmo derivou. O servidor não sabe "quem é" o dono do token — nem "quem mandou" (o `from` vive dentro do sealed). Sem puxada, TTL expira (a entrega assíncrona é o preço da ausência de identidade no servidor — igual Session/SOX).
5. **Signalização P2P embutida no sealed:** SDP offer/answer/ICE do WebRTC viajam como envelopes `kind:'signal'` cifrados entre os dois endpoints (hoje `/api/signal/*` guarda SDP em claro atrelado a contas). PeerJS cloud (`0.peerjs.com`) morre: `npm rm peerjs`, unificar na stack `webrtc.ts` + ICE hygiene existente.
6. **TURN/STUN do site, creds efêmeras:** `GET /api/turn-credentials` (prova de posse da Ed25519, mas a resposta NÃO fica logada associada a conexão): `username="<rand>:<exp>"`, `credential=HMAC(TURN_SECRET, username)`. ICE = STUN+TURN do site; `iceTransportPolicy:'relay'` (zero-exposure §10c preservado). coturn não loga IPs dos peers (config `no-cli`, access-log off; relay loga só bytes/turno).
7. **Conteúdo:** DM = envelope `kind:'dm'` (sealed X25519 → XChaCha20) no correio. Sala Ares-style = full-mesh de DataChannels dos membros + DEK de sala (wrap via `wrapDekForMultipleRecipients`; rewrap em leave; epoch). Feed = anúncios `kind:'announce'` no mesh/gossip; hospedagem de blob é opt-in do autor, SEMPRE cifrada com DEK do autor — o host só serve opacos, a DEK circula p/ os receptores escolhidos pelo autor.
8. **Admin na interseção, on-demand:** o admin tem um handle próprio; denúncias chegam como envelope `kind:'report'` cifrado p/ a chave do admin + KEY DISCLOSURE das mensagens escolhidas (DEK/shared-secret por envelope) + `denouncer_sig`. Admin valida escopo (cada chave abre exatamente o envelope reportado — TDD: chave extra → 400), julga, audit-loga `unseal`. Sem disclosure = sem leitura, nunca. Blobs: admin pede apagar por object-id opaco.

## 3. Consequências travadas pela Lei

- **Não existe "quem está online" confiável**: presença é heurística entre peers (hello-echo no mesh). UI: status "visto por seus pares", nunca status do servidor. O pill atual (isWsConnected) vira "correio conectado" (à sua conexão com o site, sem afirmar identidade).
- **Migração das DMs antigas**: export local ANTES de desligar `pm.ts` no site (script Phase 3.x com aviso).
- **Feed não-buscável no servidor**: explore vira função client-side sobre o que você recebeu/decifrou. Maior risco de adoção — documentar; mitigação de discovery: salas públicas = gossip P2P de listas de sala.
- **Moderação proativa (keyword-scan, scan de imagem) é impossível** — age-gate/blocklist continuam 100% client-side (já obrigatórios, §8); surface admin 100% report-driven.
- **TTL de envelopes**: sem nome de destinatário, expiração é o único garbage-collect; remetente pode "reenviar" (fila local, já existe IndexedDB em `storage.ts`).
- **Correlação tráfego×tempo** (quantos envelopes/seg por token) é metadata que sobra em QUALQUER correio; atenuação: padding de tamanho fixo por classe + jitter de entrega no cliente. (Não há como zerar sem onion-routing — explicitado p/ fora do escopo.)

## 4. Topologia do site

- Site oficial roda: estáticos + `routes/rendezvous.ts` (correio) + `routes/turn.ts` (creds) + `GET /api/health`. `SITE_SERVICES=mail,turn` gateia o resto: feed/econ/cards/pm-legacy ficam OFF no site.
- Economia/duels/marketplace precisam de state? Ficam onde o HOST for: self-host da cópia (api-stage) continua 1º-cidadão (modo host atual), ou um "serviço comunitário" que os usuários escolhem — nesse serviço, conteúdo = opacos, transações = ids/saldos. O site oficial NÃO roda isso.
- `server-mode.cjs`: default empacotado = `mail` apontando p/ site oficial (URL configurável no 1º run, sem segredo hardcoded); self-host LAN preservado.

## 5. Plan de implementação

### Phase 0 — Base 1.0.1 (prereq, desta sessão)
- 0.1 ✅ merge `fix/1.0.1-bugs` (6 fixes) + exe rebuilt com servidor empacotado vivo; smoke: upload, DM, fechar.
- 0.2 tag `v1.0.1` + GH release.

### Phase 1 — Envelope + protocolo de correio (packages/protocol) ✅ IMPLEMENTADO (ac83ddb+)
> Decisões travadas no código: token = **blake3(Ed25519 pubkey)** (a pubkey que assina — permite ao correio verificar o ACK sem nunca ver identidade em claro no wire; token ≠ orbitId → não-oficialmente desassociável). Semântica de fila = **Session swarm**: `list` é idempotente (não drena), `ack {ids,pubkey,sig}` prova posse (token=blake3(pubkey) + Ed25519 sobre `token|ids`) e só então apaga — quem chuta um token não consegue fazer DoS deletando a caixa alheia. `open1to1` exige `fromEph` (encPub do sender, ECIES input — material público sem nome).

1. **1.1** ✅ `packages/protocol/src/envelope.ts`: `Envelope{v:2,kind:'mail|signal|announce|invite|report',to,id,sealed,fromEph?,exp?}` + `seal1to1/open1to1`, `sealGroup/openGroup` (DEK XChaCha nonce||ct), `signEnvelope/verify` embutidos no inner (binding `v2|kind|id|to|body`). 13 testes (round-trip, tamper, rebinding kind/to, versão, dedupe de id, binary-safe).
2. **1.2** ✅ `packages/protocol/src/mail.ts`: `deliveryToken(pubKeyHex)`, `tokenMatches`. Teste do vetor blake3 incluso.
3. **1.3** ✅ exports no index + gate do pacote.

### Phase 2 — Servidor: correio anônimo (apps/api) — EM ANDAMENTO
2.1 ✅ (parcial) `apps/api/src/mail-store.ts` + `routes/mail.ts`: store em memória (in-memory de propósito: opacos não-puxados morrem no restart — ver comentário), shape-validation, TTL+caps (per-token 256/global 50k), sweep 60s; REST `PUT/GET /api/mail/:token`, `POST /api/mail/:token/ack`; WS anônimo `/api/mail/ws` (watch/unwatch/pull por token, sem auth/identidade; notices `{type:'mail',to,id}` sem conteúdo). 17+9 testes (REST, WS, injeção de forma, verbatim-bytes, no-plaintext-on-wire).
2.2 ✅ `apps/api/src/turn-creds.ts` + `routes/turn.ts`: `GET /api/turn/credentials` (orbitAuth; username=`<rand16hex>:<exp>` RANDOM — nunca orbitId → logs coturn não atribuem a ninguém; HMAC-SHA256 padrão coturn use-auth-secret; `TURN_SECRET` unset → `{enabled:false}` e o cliente cai p/ STUN/LAN, sem dead-end). 10 testes.
2.3 ⬜ SITE_SERVICES gate em `serve.ts`/`index.ts`: modo site = só mail+turn+health+estáticos; demais rotas → 404 (config-driven).
2.4 ⬜ `GET /api/users/online` atrás do gate (fora do modo site).

### Phase 3 — Cliente: caixa, mesh e salas (apps/desktop)
3.1 `utils/mail-client.ts`: conexão WS anônima + pull periódico no boot/foreground, push p/ caixa de um peer, retry+jitter, fila local IndexedDB (`storage.ts`), padding+jitter p/ anti-correlação. Unit (mock socket).
3.2 `utils/mesh.ts`: RTCPeerConnection-per-peer (reuso do núcleo `webrtc.ts`), signaling `kind:'signal'` via mail; DataChannels `dm` + `room:<id>`; reconexão/LRU~16. Unit jsdom: handshake, fanout grupo.
3.3 `sendPm`/inbox (`App.tsx`, `GoonMatchDMs.tsx`) p/ mail+mesh (source = IndexedDB local; entrega = peer vivo OU caixa). RTL: send→peer recebe ao vivo; send→offline→entra na caixa→lê no pull.
3.4 `rooms.ts` + UI `/#/rooms` (Ares-style): criar sala, invite envelope com DEK wrapped (receptáculo: p2p mail), leave/rewrap epoch, gossip de lista de salas entre membros. + migração/export das DMs antigas (`/api/pm` self-host → local).
3.5 `npm rm peerjs`; sweep `grep -rn "peerjs\|0.peerjs\|users/online"`.

### Phase 4 — Blobs/feed opt-in opacos
4.1 publish p/ host = blob já cifrado DEK-autor + manifest assinado (`encrypted-content.ts` estendido); host serve 403 sem o id exato.
4.2 render de feed p/ announce E2EE no mesh; explore = busca local do que foi decifrado.
4.3 cards/marketplace: imagem = opaco; DEK entregue via mail pago (comprador↔vendedor).

### Phase 5 — Moderação on-demand
5.1 `POST /api/admin/reports/:id/unseal` (TDD escopo estrito) + `report` envelope mail→handle-admin; UI report seletor-de-mensagens + disclosure + `denouncer_sig`; ModerationTab reveal; audit trail.
5.2 blocklist/age-gate client-side re-afirmados em teste (§8 SPEC).

### Phase 6 — Site + hardening + release
6.1 `apps/site/` landing (download, sem analytics, página de self-host/coturn/TURN_SECRET).
6.2 deploy site + coturn auth-secret (grader manual `curl /api/turn-credentials` sem origem).
6.3 exe default → site; prompt 1º run.
6.4 adversariais E2E: wire-spy do servidor prova ausência de conteúdo/identidade em frames; ping-pong A↔B offline→caixa→pull; salas rewrap; report+unseal; TURN expira; peerjs zero (net-whitelist).
6.5 gate lint/typecheck/test/e2e + tag `v1.1.0` + GH release.

## 6. Arquivos principais
- Create: `packages/protocol/src/{envelope,mail}.ts(+tests)`, `apps/api/src/routes/{mail,turn}.ts(+tests)`, `apps/desktop/src/utils/{mail-client,mesh,rooms}.ts(+tests)`, `apps/desktop/src/components/rooms/*`, `apps/site/`.
- Modify: `serve.ts`/`index.ts` (SITE_SERVICES), `ws-bus.ts` (LEGACY off), `App.tsx`/`GoonMatchDMs.tsx` (migração DM), `useP2P.ts`/`peer-relay.ts` (PeerJS fora), `ice-hygiene.ts` (fetchTurnCreds), `webrtc.ts` (signal via mail), `migrate.ts` (caixas/rooms), SPEC §13 novo.

## 7. Riscos / aberto
1. **Sem FS** (X25519 estático): follow-up prekeys/ratchet (1.2).
2. **Adoção do feed sem índice** (ver §3) — decisão do usuário: aceitar ou publicar manifests opt-in.
3. **TTL caixa vs remetente** — fila local com reenvio; UI de estado (entregue/só-read).
4. **Full-mesh O(N²)** — cap 32/sala, além disso "relay-operators" membros (ainda E2EE).
5. **Correlação de tráfego** — padding+jitter; onion = fora do escopo.
6. **Banda TURN** — caps/turno, fallback direto em LAN.
7. **Admin perde visibilidade proativa** — aceito pela Lei; disclosure + client-side gates.
8. **Migração das PMs antigas**: export guiado antes do SITE_SERVICES desligar pm (avisar usuário).
