# HANDOFF — coordenação gMatch (Hermes ↔ OpenCode concorrente)

Branch desta frente: **`feat/encrypted-api-servers`** (ponytail + encrypted API + Servers).
Plano: `.hermes/plans/2026-09-09_161233-ponytail-encrypted-api-servers.md`.

## Estado da árvore na abertura (snapshot 2026-09-09 ~16:17)

### Commitado por MIM (Hermes) nesta frente
- `d0a7868 feat(ui7)` — group members: `apps/api/src/routes/groups.ts` (GET /:id/members), `groups.test.ts`, `apps/desktop/src/components/chat/GroupMembersPopover.tsx` + `.test.tsx` (4 API + 4 RTL, verdes).
  - Wiring `GMatchDMs.tsx`/`App.tsx`/`MessagesView.tsx` para o popover ficou NO working tree compartilhado (misturado com edições do OpenCode) — **NÃO commitado** para não sugar work alheio. Ver "Pendências" abaixo.

### Provável do OpenCode (OUTRO agente) — NÃO tocar, NÃO commitar
Arquivos novos NÃO-rastreados que não são meus:
- `apps/desktop/electron/customFolders.cjs` + `.test.cjs`
- `apps/desktop/src/components/CropModal.tsx`, `useCropper.tsx`
- `apps/desktop/src/services/customSources.ts` + `.test.ts`
- `apps/desktop/src/components/grid/CustomSourcesModal.tsx`
- `apps/desktop/src/components/domination/HacksPanel.tsx`
- refs em `main.cjs`/`preload.cjs` a `customFolders`

### Ambos-árvore modificados (dividido; o OpenCode pode ter mexido junto)
`App.tsx`, `StoreTab.tsx`, `main.cjs`, `preload.cjs`, `legal/documents.ts`, `site/*`, `public/legal/*`, routing, views. O tsc + suites API estão limpos agora (verificado 16:19).

## Regras para as duas frentes
1. **Nunca `git add -A` / `git commit -a`** com o outro vivo — só caminhos explícitos.
2. Uma escrita por arquivo. Se a minha task precisa de `App.tsx`/`SidebarNav`/`api.ts` e o OpenCode os tem abertos, ESPERAR a dele terminar (confirmar com o usuário) antes de editar.
3. Antes do merge desta branch, rodar o gate completo (lint + 2 tsc + 2 vitest + Playwright 12/12).

## Pendências que ficam no working tree (não quebrar)
- `onLoadGroupMembers={loadGroupMembers}` / `onAddGroupMembers` já passados em `App.tsx:2920-2921` + popover mount em `GMatchDMs.tsx` — funcional, só não commitado. Quem limpar a árvore por último deve commitá-los junto do restante do UI-7.

## Perguntas em aberto para o usuário
- "≥1 player segura a info do servidor" → replicação automática real é pesquisa (fora de escopo); Fase 6 entrega snapshot manual admin. Confirma que snapshot manual basta?
- Senha do servidor: recomendar senha longa na UI (lockout já cobre brute-force). OK?
