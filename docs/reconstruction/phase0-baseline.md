# Fase 0 — linha de base e evidências (main @ bb56198, 2026-10-14)

Branch `main`, commit-base `bb56198`, árvore limpa (só 3 artefatos runtime
untracked). Tag `archive/perf-feed-latency-2026-10-14` + stash
`security/wave2-ip-masks` preservados. Nenhum commit da branch abandonada foi
recuperado; os keeps já estão em `main`. Docs consultados: `RECONSTRUCTION.md`,
`ARCHITECTURE.md`, `P2P.md`, `SECURITY.md`, `DECISIONS.md`, `NET.md`.

## 1. Linha de base dos testes (tudo verde, exceto o teste-evidência novo)

| Suíte | Arquivos | Testes | Resultado |
|---|---|---|---|
| API: posts, cards, objects-security/signed-url/zero-media, domination, likes | 7 | 94 | PASS (16s) |
| Desktop: GMatchFeed (filter/video/authorClick/header/nudge), InstagramPostModal, useProfilePostLightbox, PostLikersModal, PostTimestamp, CreateCardModal, cardCollection | 11 | 53 | PASS (13s) |
| Novo `GMatchFeed.like-reconcile.test.tsx` (3 testes TDD da Fase 1) | 1 | 3 | **FAIL 3/3 — bug provado (ver §2)** |

## 2. Evidência bug 1 — flicker do like (causa raiz confirmada, 3 mecanismos)

`GMatchFeed.tsx:504-523` coloca o `onPersistLike` **dentro do updater** do
`setLikedPosts` (side effect em função que deve ser pura), sem `catch`, sem
rollback, sem guarda de geração e sem invalidação do cache GET de 3s
(`utils/api.ts:69,267-284`; `persistComment` invalida, `persistLike` não).

Prova executável (`GMatchFeed.like-reconcile.test.tsx`, falha 3/3 em dev/StrictMode):

1. **Duplo disparo por clique**: `persist` chamado **2×** com `('p1', true)` —
   o StrictMode invoca o updater 2× em dev (`boot.tsx:12`), e cada invocação
   dispara a mutação. (`expected spy called 1 time, got 2`).
2. **Resposta obsoleta sobrescreve mutação recente**: like→unlike com resolve
   invertido (DELETE=9 antes de POST=11) exibe `11` em vez de `9` — vence quem
   responde por último, não a mutação mais recente.
3. **Sem rollback**: `persist` rejeitado deixa o estado otimista preso
   (observado `12 likes` após 1 clique partindo de 10 — duplo +1 sem reversão)
   + `unhandled rejection` no console.

Correção (Fase 1): persist fora do updater, contador de geração por post
(respostas/invalidações obsoletas descartadas), rollback no erro, `invalidateCache`
no reconcile. Não mexer em `like_count` sem evidência nova.

## 3. Evidência bug 2 — 404s em aba anônima (causa raiz confirmada, 2 mecanismos)

Sonda determinística contra sidecar fresco local (`I:\Temp\obj404-probe.cjs`,
throwaway, fora do repo; Bun 1.4.0, `PORT=8877`, DB temporário, sem gossip):

| Caso | Resultado |
|---|---|
| anônimo → objeto privado | **404** `Object not found` (gate `objects.ts:609`, anti-enumeração por design) |
| estranho → objeto privado | **404** (gate `:615`) |
| dono → objeto privado sem blob | **404 `{"purged":true}`** — a linha EXISTIA e foi **apagada pela leitura** |
| anônimo → objeto público sem blob | **404 `purged:true`** — idem |
| 2º GET nos mesmos ids | **404 sem `purged`** — linhas destruídas, evidência sumiu |
| UUID inexistente (ex. `ce0fd015-…`) | 404 `Object not found` (`:575`) |
| `p2p-obj-abcdef` | 404 `stored client-side in browser IndexedDB` (`:561`) |

Causa raiz: `GET /api/objects/:id` (`objects.ts:723-732`) chama
`purgeDeadObject()` quando o blob falta — **leitura destrói dado**. Linhas
só-metadados (`content_url=/api/objects/:id`, sem bytes) são legítimas
(réplicas gossip, posts offline, uploads com PUT falho); a primeira
visualização apaga a linha e o 404 vira permanente. Numa conta fresca em dev,
o feed referencia mídias sem blob → console cheio de 404, e cada 404 apaga
mais uma linha. Em aba anônima soma-se o gate de auth (qualquer objeto
não-público 404 sem `X-Orbit-*`).

Correção (Fase 2): classificar cada 404 com evidência do dev; nunca apagar
linha em GET (quarentena/sweep explícito em vez de purge na leitura);
regression test específico. Serialização/referências/persistência: não tocar
até a classificação (condição 2 do briefing).

## 4. Auditoria `p2p:send` + binding (condição 4 — reuse aprovado com gaps)

Lido: `electron/p2p-host.mjs` (92L), `p2p-protocol.mjs` (109L).
`send()` exige binding com assinatura Ed25519 válida + `orbitId==sha256(pubkey)`
+ `binding.peerId === próprio id` — nunca confia em identidade declarada além
da assinatura. Main nunca vê plaintext; renderer é dono do `open1to1`.

Gaps a fechar antes do Domination mesh (§6): **sem proteção de replay**
(id do envelope não dedupado), **`exp` do envelope não verificado no main**
(`decodeFrame` ignora), sem gancho de consentimento/capability no receptor,
sem verificação de tamanho além do cap de frame. Economia: mesh sem
cobrança/payout (decisão travada); g$ hospedado intocado.

## 5. Auditoria mídia (condição 5 — fluxos que aceitam URL)

A mapear na Fase 5/6 antes de qualquer fetch de URL remota: `ActionModal`
(`wallpaper/game_bg/popup_video` aceitam `http(s)` arbitrário —
`DominationEffects` faz `fetch(url)` direto na vítima: SSRF/vazamento de IP/
mídia maliciosa), `CreatePostModal` uploads por URL, `AttachmentUploadModal`,
`vaultHttpUrl`, proxy de `/px` (allowlist existe — reutilizar o padrão).
Regra: allowlist de hosts + `http(s)` apenas + bloqueio de destinos
link-local/loopback/RFC1918 + teto de bytes + timeout; nunca fetch cego.

## 6. Evidências por categoria (condição 7)

- Unitários: suítes acima (vitest) + novos testes de regressão por fase.
- Integração local: sidecar throwaway + sondas node (como a §3); dois
  processos em datadirs separados quando o transporte entrar em jogo.
- Dois PCs físicos: **não realizado aqui**; todo teste que exigir será
  marcado `unverified-2pc` e nunca contará relay/mesma-máquina como direto.
