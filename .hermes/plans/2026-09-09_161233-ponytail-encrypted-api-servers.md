# gMatch — ponytail skill, encrypted API, and federated Servers (create/join/admin)

> **Para a Hermes:** executar fase-por-fase, TDD em cada task, gate por commit:
> `cd /i/goongrid && npm run lint` (0 erros) + `npx tsc -p apps/api/tsconfig.json --noEmit` + `npx tsc -p apps/desktop/tsconfig.json --noEmit` (limpos) + `cd apps/api && npx vitest run` + `cd apps/desktop && npx vitest run` (tudo verde).
> **Estilo de trabalho: ponytail.** Menos código vence. Reusar o que já existe (full-node, server-mode, SITE_SERVICES, admin suite, Envelope v2) antes de escrever qualquer coisa nova. Nenhum framework novo, nenhuma camada nova que não seja pedida.

## Goal
Adicionar ao gMatch: (1) skill ponytail no repo + no Hermes, (2) criptografia de ponta-a-ponta também nos **requests** da API (hoje só respostas de conteúdo são seladas; corpo de mutação viaja assinado mas em claro), e (3) um conceito de **Servers** (federação de nós): criar/entrar/alternar servidores, criador = admin com a suíte administrativa já existente no rodapé da sidebar, senha opcional de entrada, dashboard com userlist por servidor — tudo reaproveitando a topologia full-node que o app já embarca.

## Current context / assumptions

- Repo: `I:/goongrid` (GitHub `9matesu/goongrid`), branch de trabalho `security/audit-hardening` (tag `v1.1.0`, tudo pushado **exceto** a árvore suja atual).
- **Árvore suja AGORA (~63 arquivos):** contém (a) meu trabalho UI-7 incompleto (`GroupMembersPopover`, wiring `GMatchDMs`/App, rota GET members no groups.ts+test) e (b) provavelmente edições de um **segundo agente OpenCode** rodando na mesma árvore com outra task (UI dev: wallpapers, opacidade, etc.). **Task 0 resolve isso antes de qualquer linha nova.**
- Arquitetura existente que este plano REUSA (não reinventar):
  - **Full-node vs site**: `apps/desktop/electron/server-mode.cjs` (HOST o servidor empacotado local OU CLIENT de um servidor de amigo; env `GMATCH_SERVER_URL` sobrepõe) + `apps/api/src/site-services.ts` (gate `SITE_SERVICES=mail,turn` no nó central).
  - **Identidade/assinatura**: `apps/api/src/middleware/auth.ts` — header `X-Orbit-Id/Timestamp/Signature/PubKey` assinando `method|url|timestamp|body` (Ed25519). Já bloqueia replay; **não** cifra o corpo.
  - **Envelope v2 E2EE**: `packages/protocol/src/envelope.ts` (`seal1to1/open1to1` ECIES X25519+XChaCha20-Poly1305, sig Ed25519 anti-rebinding) — a mesma primitiva vale para cifrar requests.
  - **Admin suite**: `apps/api/src/routes/admin.ts` (PIN → `is_admin`, dashboard, content-reports, users, force-all…) + `apps/desktop/src/admin/AdminApp.tsx` (rota `/#/admin`). `ADMIN_PIN_HASH` com lockout já existe (B.4).
  - **Economy/DB por nó**: cada full-node tem SQLite próprio (`orbit.snapshot.sqlite`) → servidores diferentes JÁ têm posts/economia/conteúdo separados por construção.
  - **Landing/settings**: UI de servidor já existe (`ServerTab.tsx` com host/client + relaunch).
- **Outro agente OpenCode ativo**: coordenação = branch/worktree isolado para NÓS (nunca editar os mesmos arquivos); contrato de merge no final.
- ponytail: repo `DietrichGebert/ponytail` (MIT). Instalação Hermes oficial: `hermes plugins install DietrichGebert/ponytail --enable` + restart. Para o OpenCode do repo: as skills vivem em `.agents/skills/` (mesma pasta dos `better-*` já instalados) → vendorar `skills/ponytail*` de lá.
- Assunção do pedido "todo player segura um pedaço do servidor privado; o servidor está no ar se ≥1 player tiver a info": o mapeamento honesto no modelo atual é **host = criador** (full node na máquina dele) + **replicação opcional de snapshot** para hospedeiros suplentes (fase P5, marcada como a parte cara e com risco; NÃO construir antes de P1-P4 estarem verdes).
- Assunção: "central node" = o deploy oficial do `9matesu/goongrid` (o usuário é o admin via PIN). Criar servidor = rodar o próprio nó + anunciar no diretório público do central.

## Architecture / proposed approach

Server = instância da API gMatch (o bundle que todo app já carrega). Um **directory** no nó central (rotas `mail`-like, cego por design: só lista id/nome/pubkey do host/flags — nunca conteúdo) permite **descobrir e entrar** servidores; entrar = trocar o `apiBase` local para o endpoint do host (o mecanismo client-mode de `server-mode.cjs` já faz isso). O **criador** registra o próprio nó no directory com a pubkey Ed25519 da identidade → vira admin do nó (flag `is_admin` at-relaunched). **Senha de entrada** = challenged-token PBKDF2 verificado pelo host no handshake, emitindo sessão; **requests cifrados** = envelope ECIES reutilizando `seal1to1` para bodies de POST/PUT/PATCH (chave pública do nó obtida em `GET /api/identity`, cacheada) — assinatura atual permanece dentro do selo.

## FASE 0 — Coordenação com o OpenCode concorrente + snapshot da árvore (pré-requisito absoluto)

### T0.1 Inventariar quem é meu e quem é do outro agente (~5 min)
```bash
cd /i/goongrid && git status --short | head -70 && git diff --stat | tail -3
```
Classeificar cada arquivo modificado:
- **UI-7 meu (incompleto):** `apps/api/src/routes/groups.ts`, `groups.test.ts`, `apps/desktop/src/components/chat/GroupMembersPopover.tsx(.test)`, `GMatchDMs.tsx`, `App.tsx`, `MessagesView.tsx`, `secure*`, `imageCache*`, `legal/*`, `site/*`, `main.cjs`, `preload.cjs`.
- **Provável do outro agente:** qualquer coisa de wallpapers/opacidade/presets/Settings que eu NÃO toquei nesta sessão.
Escrever a lista em `.sprint/HANDOFF.md` (commit junto do snapshot).

### T0.2 Snapshot-commit do MEU work (só os meus caminhos, nunca `git add -A`) (~5 min)
```bash
cd /i/goongrid && git add apps/api/src/routes/groups.ts apps/api/src/routes/groups.test.ts apps/desktop/src/components/chat/GroupMembersPopover.tsx apps/desktop/src/components/chat/GroupMembersPopover.test.tsx && git commit -m "wip(ui7): GET /api/groups/:id/members + GroupMembersPopover (TDD green: 4 tests)"
cd apps/api && timeout 120 npx vitest run src/routes/groups.test.ts 2>&1 | grep -E "Tests |Test Files"
```
Esperado: `Tests 4 passed (4)`.
Depois verificar o estado dos arquivos em-andamento do OpenCode: se `GMatchDMs.tsx`/`App.tsx` tiverem edição DELE sobreposta à minha, NÃO commitar esses dois ainda — registrar pendência em `.sprint/HANDOFF.md` e seguir (eles ficam no working tree dele).

### T0.3 Branch isolada para este plano (~2 min)
```bash
cd /i/goongrid && git checkout -b feat/encrypted-api-servers && echo BRANCH_OK
```
Regra para o resto do plano: nunca fazer merge em `security/audit-hardening` sem rodar os gates; o OpenCode trabalha na árvore dele.

## FASE 1 — ponytail (skill no repo + plugin no Hermes)

### T1.1 Instalar o plugin Hermes (~3 min; comando único, usuário confirma restart)
```bash
hermes plugins install DietrichGebert/ponytail --enable
```
Esperado: plugin listado com `hermes plugins list | grep -i ponytail` → `ponytail … enabled`. Pedir ao usuário para reiniciar o Hermes/gateway (não dá para fazer no mesmo processo). Verificação pós-restart: `/ponytail-help` responde.

### T1.2 Vendorar as skills no repo para o OpenCode (e qualquer CLI que leia `.agents/skills`) (~10 min)
```bash
cd /i/goongrid && git clone --depth 1 https://github.com/DietrichGebert/ponytail /tmp/ponytail-src
cp -r /tmp/ponytail-src/skills/ponytail /tmp/ponytail-src/skills/ponytail-review /tmp/ponytail-src/skills/ponytail-audit /tmp/ponytail-src/skills/ponytail-debt /tmp/ponytail-src/skills/ponytail-gain /tmp/ponytail-src/skills/ponytail-help .agents/skills/
cp /tmp/ponytail-src/LICENSE .agents/skills/ponytail-LICENSE
ls .agents/skills/ | grep ponytail | wc -l   # esperado: 6
```
Verificar que o formato é o mesmo dos `better-*` (SKILL.md com frontmatter `name:`): `head -6 .agents/skills/ponytail/SKILL.md`.
Commit: `chore(skills): vendor ponytail (MIT) — laziest-senior-dev ruleset for all agents in this repo`.

### T1.3 Aplicar ponytail a este plano desde já (~2 min)
Ler `.agents/skills/ponytail/SKILL.md` e seguir: em toda task abaixo, antes de escrever código, perguntar "qual linha eu NÃO preciso escrever?". As tarefas já foram escritas na versão preguiçosa (reuso total do existing full-node/envelope/admin); manter assim.

## FASE 2 — Encrypt API requests (corpos de mutação ECIES; assinatura vai DENTRO do selo)

Contexto: hoje `orbitAuth` exige `X-Orbit-Signature` sobre `method|url|ts|nonce|body` em claro. O corpo viaja por TLS no central, mas em **self-host LAN sem TLS** é plaintext — e o pedido é cifrar sempre. Design lazy: **header novo `X-Orbit-Sealed` com um Envelope v2 (seal1to1) cujo body é o JSON original + o cabeçalho de assinatura old-style; quando presente, o servidor decripta ANTES do verify** e o resto do pipeline não muda uma linha.

### T2.1 Failing test do lado do servidor (~15 min)
Create `apps/api/src/middleware/auth-sealed.test.ts`:
```ts
// Reuses test-utils identities; seals a legit signed request into an
// Envelope v2 to the SERVER key and asserts orbitAuth accepts it, and that
// plaintext-without-header still works (migration period).
```
TDD real: montar `seal1to1(senderIdentity, serverPub, JSON.stringify({ ...originalHeaders, body }))`, enviar `POST /api/objects` com header `X-Orbit-Sealed: <b64 envelope.sealed + '|' + fromEph>` SEM os headers X-Orbit-*, esperar 201. Segundo caso: corpo válido mas `X-Orbit-Sealed` corrompido → 400 `invalid seal`. Rodar: `cd apps/api && npx vitest run src/middleware/auth-sealed.test.ts` → FALHA (header não existe).

### T2.2 Rota de identidade do nó (~10 min)
`apps/api/src/index.ts`: adicionar `GET /api/identity` público returning `{ server_pubkey: <X25519 pub hex>, server_id: <sha256(pubkey)>, name, sealed_required: !!process.env.API_SEALED_ONLY }`.
A chave do nó: gerar/persistir em `storage-key.ts`-style (`apps/api/src/node-key.ts`): `resolveNodeKey()` lê/gera `node.key` (32 bytes X25519 priv, hex) ao lado do snapshot; publica só a pública. Teste `node-key.test.ts` (round-trip determinístico em dir temporário).

### T2.3 Middleware de unseal (~25 min)
Create `apps/api/src/middleware/seal.ts`:
```ts
import { openSealedRequest } from '@orbit/protocol' // wrapper abaixo
export async function unsealRequest(c: Context, next: Next) {
  const sealed = c.req.header('X-Orbit-Sealed')
  if (!sealed) {
    if (c.env.API_SEALED_ONLY && MUTATING(c.req.method)) return c.json({ error: 'sealed requests required' }, 400)
    return next() // compat: signed-plaintext ainda vale
  }
  let inner: { headers: Record<string, string>; body: string }
  try { inner = openSealedRequest(c.env.NODE_PRIV_HEX, sealed) } catch { return c.json({ error: 'invalid seal' }, 400) }
  c.set('sealedBody', inner.body)
  c.set('sealedHeaders', inner.headers)
  return next()
}
```
`packages/protocol/src/envelope.ts`: reusar `open1to1` — adicionar wrapper `openSealedRequest(nodePrivHex, headerValue)` que splita `sig|b64`, chama `open1to1` e valida `kind === 'api_req'`. Em `orbitAuth`, ler headers/body primeiro de `c.get('sealedHeaders'/'sealedBody')` quando setados (2 linhas em `middleware/auth.ts`, resto intacto). Wiring: `index.ts` `app.use('/api/*', unsealRequest)` **antes** de `orbitAuth`, e injetar `NODE_PRIV_HEX`/`API_SEALED_ONLY` no `env` de `serve.ts`.

### T2.4 Cliente: selar mutações (~20 min)
`apps/desktop/src/utils/api.ts` — em `orbitFetch`, para métodos mutantes: buscar `GET /api/identity` (cache módulo, TTL 1h; em falha → fallback plaintext-assinado), montar `{ headers: <os headers de assinatura originais>, body }`, `seal1to1(myIdentity, serverPub, JSON.stringify(payload))`, enviar só `X-Orbit-Sealed`. Teste `api.seal.test.ts` (vi.stubFetch): corpo trafega cifrado (assert `payload` não contém a string `'caption':'oi'` mas contém `X-Orbit-Sealed`); falha de identity → caminho legacy ativo.

### T2.5 Flag hard-mode + docs (~10 min)
`serve.ts`: `API_SEALED_ONLY=1` → mutações sem seal rejeitadas (400). Teste no T2.1 já cobre. `docs/SPEC.md` §Crypto: 4 linhas descrevendo o header novo. Gate completo + commit: `feat(api): ECIES-sealed request bodies (envelope v2 kind=api_req), signed legacy path kept, API_SEALED_ONLY kill-switch`.

## FASE 3 — Servers: directory no central + criar/entrar/alternar

### T3.1 Decisão de design registrada (5 min, sem código)
Escrever em `docs/ADR-002-servers.md` (curto, ponytail-style): servidor = full node; criar = HOST local + registrar no directory central; entrar = salvar base URL + token de sessão; **sem** replicated DHT nesta versão (fase P5 discute); senha verificada pelo HOST (nunca pelo central).

### T3.2 Migration + tabela Servers directory (~15 min)
`apps/api/migrations/045_server_directory.sql`:
```sql
CREATE TABLE IF NOT EXISTS ServerDirectory (
  id TEXT PRIMARY KEY,            -- sha256(owner_pubkey|name|salt16)
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,         -- orbitId do criador (admin do seu node)
  owner_pubkey TEXT NOT NULL,     -- Ed25519, pra verificar o registro
  endpoint_hint TEXT NOT NULL DEFAULT '', -- host:porta OU ''. vazio = só lista, sem conectar
  password_required INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);
```
TDD: `apps/api/src/routes/servers.test.ts` primeiro (404 hoje): POST register (assinado) → 201; GET list → `[...]`; re-register mesma pubkey+name upserta; DELETE só por dono.

### T3.3 Rotas directory (~30 min)
Create `apps/api/src/routes/servers.ts` (montar em `index.ts` como `/api/servers`; **liberado no gate SITE_SERVICES**: `site-services.ts` allow-list += `/api/servers`, pois é só metadado público, igual `/api/turn`):
- `POST /api/servers` — `{ name(1-60), description(≤200), endpoint_hint(≤120, validado formato), password_required }` + sig do dono; id = `sha256(pubkey|name)`; máx 5 entries por dono (anti-spam).
- `GET /api/servers` — lista pública (sem IPs de quem consulta; rate-limited já herdado).
- `DELETE /api/servers/:id` — dono only.
- `POST /api/servers/:id/ping` — heartbeat assinado pelo dono (atualiza `last_seen`; some da lista após 24h sem ping).
Commit: `feat(api): public server directory (register/list/unregister/heartbeat) + SITE_SERVICES allow-list` (gates completos).

### T3.4 Cliente: tab "Servers" na sidebar + roteamento (~40 min)
- `src/utils/routing.ts`: `ROUTE_VIEWS` += `'servers'`; alias `node`.
- `src/components/home/SidebarNav.tsx`: nav item `{ id: 'servers', label: 'Servers', icon: Network }` (lucide `Network`).
- Create `src/components/views/ServersView.tsx`: lista do directory (nome, dono abreviado, badge 🔒 se senha, "você está aqui" no servidor atual), botão **Join** → dialog: endpoint + senha (se requerida) → `window.gmatch.serverSet({ mode:'client', url })` (API que JÁ existe: `preload.cjs`/`server-mode.cjs`), re-fetch health do nó novo; **Create** wizard: nome/desc/password → liga HOST local (`serverSet({mode:'host'})`, já implementado com relaunch) → após health, `POST /api/servers` no CENTRAL (base URL do central vem de `apps/desktop/src/utils/central.ts` novo, constante `CENTRAL_API_URL` env-sourced `NEXT_PUBLIC_CENTRAL_URL`, default vazio = aba funciona só com lista local) com `endpoint_hint` opcional (aviso explícito de NAT/UPnP na UI — texto de 2 linhas, sem código de port-forwarding).
- App.tsx: branch `mainView === 'servers'`.
Testes: RTL de `ServersView` (3 casos: lista renderiza, join chama serverSet, sem CENTRAL a aba mostra explicação, não crash).

### T3.5 Admin button no rodapé da sidebar para o dono (~10 min)
`SidebarNav.tsx`: quando `directoryMine === true` (dono do nó atual — ver T3.6) OU `isAdminUser`, mostrar botão `Admin panel` (ícone `Shield`) abaixo do user panel, indo em `/#/admin` (rota AdminApp já existe). Ficar sem botão para não-admins.

### T3.6 Flag "este nó é meu" (~20 min)
`GET /api/identity` (T2.2) += `owner_id` (o orbitId que registrou/desbloqueou o nó) → cliente compara com a identidade local. No nó local recém-criado: `POST /api/admin/verify-pin` com PIN GERADO no primeiro boot do host e impresso no console/`server-state` → `ServerTab.tsx` mostra o PIN para o dono copiar e destrava `orbit_admin_identity` (o fluxo admin existente faz o resto — a suíte completa + moderação já funciona sobre `is_admin`). Teste: `identity.owner_id` present quando registrado.

Commit da fase: `feat(servers): directory-driven create/join/switch on top of host/client mode; owner admin affordance`.

## FASE 4 — Dashboard por servidor + userlist

### T4.1 `GET /api/servers/dashboard` no HOST (não no central) (~30 min)
TDD primeiro (`servers-dashboard.test.ts`): rota autenticada retorna `{ name, owner_id, users: [{ id(prefixo 8), display_name, online }], posts_24h, members_total }`. Implementação = 3 SELECTs no `Users`/`Objects` do próprio nó (roster já existe em `routes/users.ts` — extrair helper `serverStats(db)`, DRY). Privacidade: `users` só com `display_name` público + id truncado + boolean online (janela 60s já usada no gate de hacks). Rate-limit herdado. Sem auth → 401.

### T4.2 Dashboard na ServersView (~30 min)
Cada card de servidor no estado "conectado" mostra o dashboard do T4.1 (fetch contra o BASE URL daquele nó — `api.ts` ganha `orbitFetchAt(baseUrl, ...)`, 10 linhas, reuso do signer). Lista de servidores remotos listados no central só têm o metadado do directory (sem userlist — o central nunca hospedou essa info; honesto por design, e documentar no tooltip: "membros só aparecem quando você está conectado a esse servidor").

Commit: `feat(servers): per-node public dashboard (userlist online + stats) fetched from the node itself`.

## FASE 5 — Senha do servidor (handshake no HOST) + sessão

### T5.1 Esquema (~40 min, TDD nos dois lados)
- Host: `API_JOIN_PASSWORD=<string>` → `POST /api/join { password }` verifica PBKDF2 (padrão já existe em `auth` local do Modulair? Não — reusar `crypto` node: `scryptSync`), emite `join_token` (HMAC com STORAGE key, expira 30d) guardado no cliente no **secure KV (DPAPI)** via `setSecureItem('gmatch.join.<nodeId>', token)`.
- `orbitAuth` no host exige header `X-Orbit-Join` em MUTAÇÕES quando `API_JOIN_PASSWORD` setado (rota de leitura de health/identity pública permanece). 
- Testes: wrong password 401 + lockout 5/15min (reusar `pinFails` map de B.4 — extrair helper `slidingLockout()` do admin.ts, DRY).

### T5.2 UI (~20 min)
Join dialog (T3.4) passa a chamar `/api/join` quando o nó anuncia `password_required` (campo novo no `GET /api/identity`). Erro de senha → toast ruidoso, token limpo.

## FASE 6 — "Pedaço do servidor em cada player" (honestidade + opção snapshot)

### T6.1 Registrar o limite no ADR (~10 min)
Replicação P2P com host rotation é pesquisa, não feature: `docs/ADR-002-servers.md` += seção "Availability": o servidor está no ar enquanto o HOST estiver online (full-node atual). Suplentes: **opt-in manual** — `POST /api/admin/export-snapshot` (rota admin já existe? NÃO → adicionar: stream `snapshotDb` atual, assinado) → importador `serverSet({mode:'host'}) + restore file` no próximo host. Nada automático. Isso cobre o caso "host sumiu; alguém tem o snapshot e assume" SEM construir DHT.

### T6.2 Teste de aceitação do fluxo (~20 min)
E2E-able: `apps/api/src/snapshot-export.test.ts` — rota exige admin, retorna bytes que restauram num DB virgem (usar `restoreDb` existente). Commit: `feat(servers): admin snapshot export/import as the honest availability story`.

## FASE 7 — Docs + loop de engenharia

### T7.1 `docs/SPEC.md` nova §13 "Servers & Federation" (~20 min)
Meia página: modelo (directory só no central; conteúdo 100% no nó; senha = no host; admin = dono), o que o central VÊ de um servidor (nada além do registro), tabela de envs (`GMATCH_SERVER_URL`, `API_SEALED_ONLY`, `API_JOIN_PASSWORD`, `NEXT_PUBLIC_CENTRAL_URL`).

### T7.2 `docs/SECURITY-AUDIT.md` v2 append (~20 min)
Novos ataques modelados: sealed-header DoS (caps de tamanho + mesma shape-validation de mail-store), directory spoofing (registro assinado pela pubkey = dono; endpoint_hint é "hint", a conexão real é verificada pelo health+identity), join_token theft (HMAC bound à STORAGE key do host + expira). Rodar `/ponytail-audit` na diff inteira da fase + `interface-review` na ServersView.

### T7.3 Loop-gate final (~30 min)
`npm run lint` 0 · typecheck 0 · API `npx vitest run` (783+novos) · desktop (451+novos) · Playwright 12/12 · `node site/check.mjs` OK. Push da branch + PR → squash-merge em `security/audit-hardening` **só depois de perguntar ao OpenCode concorrente se ele terminou** (checar `git -C ... status` na árvore dele / coordenar com o usuário).

## Tests / validation (resumo)

Cada task segue: test RED → implement → GREEN → gate completo → commit pequeno. Novos suites: `node-key.test.ts`, `auth-sealed.test.ts`, `api.seal.test.ts`, `servers.test.ts`, `servers-dashboard.test.ts`, `snapshot-export.test.ts`, `ServersView.test.tsx`, `GroupMembersPopover.test.tsx` (da fase pendente UI-7, terminar antes de começar Fase 2).

## Risks / tradeoffs / open questions

1. **Colisão com o OpenCode concorrente é o risco nº 1** — por isso Fase 0 existe. Se ele estiver editando `App.tsx`/`SidebarNav.tsx`/`api.ts` ao mesmo tempo, nossas tasks T3.4/T2.4 precisam esperar o dele (verificar com o usuário "ele terminou?" antes de merge).
2. Cifrar requests adds latência + uma ida a `/api/identity` por sessão; o ganho real é em self-host sem TLS — no central (TLS) é defesa em profundidade. Mantido barateado: mesmo envelope, zero lib nova.
3. Directory exige que o central fique online — mas ele só guarda METADADO; se o central cair, servidores seguem funcionando e a lista vira cache local (guardar última lista em secure KV, 5 linhas).
4. `endpoint_hint` sem resolução NAT real: criar servidor atrás de CGNAT não será "joinable" de fora; UI deve dizer isso (e o app já tem o caminho TURN para P2P — futuro: hint via conexão direta P2P, fora de escopo).
5. "≥1 player holds the info" virou snapshot manual (Fase 6) — se o usuário quiser replicação automática de verdade, isso é um projeto próprio (estilo BitTorrent-swan), não um feature slice; pedir confirmação ANTES de investir (open question).
6. Admin do central: hoje PIN=único-admin-rotativo; quando o usuário-criador for admin do central, o PIN deve ser fixado por env (`ADMIN_PIN_HASH`) — documentar na Fase 3.6.
7. Senha fraca = PBKDF2 local sem rate-limit externo ainda é passível de brute-force online → lockout 5/15 herdado de B.4 cobre; recomendar senha longa na UI (placeholder texto).
