# goonMatch Grid — UI Consolidation ("catadão"): uma função = uma UI

> **Para a Hermes:** executar task-por-task com TDD (`test-driven-development`), polimento guiado por `better-ui`/`better-interface`/`better-*` (em `.agents/skills/`), e auditoria final com prints. Cada task = branch → RED → GREEN → `npm run lint` (0 err) → `npm run test` → commit.

**Goal:** Unificar TODAS as superfícies de UI do app desktop para que cada função tenha exatamente UMA entrada, com hierarquia simples, labels mínimas, presença honesta, feedback em toda ação e composer WYSIWYG — verificado por screenshots antes/depois em `docs/ui/`.

**Repo:** `I:/goongrid` (npm workspaces; app em `apps/desktop`, Vite+React19+Tailwind4). **Base da branch:** `refactor/ui-consolidation` criada a partir de `feat/secure-p2p-phase1` (a RoomsView/courier só existem lá). **Stack do shell:** `App.tsx` (~3.9k linhas, switch de `mainView`), `SidebarNav` (desktop) + `HomeFooter` (mobile) + `RightUtilityDock` (dock de ícones), `GlobalModals`.

---

## 1. Contexto atual (audit verificado em código — não assumido)

### Navegação hoje (3 superfícies, entradas duplicadas)

| Superfície | Arquivo | Itens |
|---|---|---|
| Sidebar desktop | `apps/desktop/src/components/home/SidebarNav.tsx:112-210` | Home, Porn Games, Rooms*, Store, Messages, Notifications, Cards, Settings, PC Domination, Spy* |
| Footer mobile | `apps/desktop/src/components/home/HomeFooter.tsx:83-141` | navItems PRÓPRIO (inclui gallery:141) |
| Dock direito | `apps/desktop/src/components/home/RightUtilityDock.tsx` | Chat, Players, Settings (de novo) |

`*` Rooms/Spy são condicionais. Views do `App.tsx`: `feed:2933, messages:3304(+minimized:3346), profile:3351, games:3375, rooms:3401, grid:3415, admin:3422, store:3429, gallery:3445, game:3485 (tela de partida), hack_spy:3516, pc_domination:3527`.

### Duplicações "duas UIs para a mesma função" (confirmadas)

1. **Cards/Decks em 3 lugares:** aba `cards` + `decks` dentro de Porn Games (`components/games/GamesHub.tsx:41-50`), E a view "Cards" da sidebar (`views/GalleryTabView.tsx` = Galeria + bloco `DeckBuilder` embutido, `:4,:86`). Mesma função (gerenciar cartas/decks), três entradas.
2. **Mensageria em 3 lugares:** página `messages` (`views/MessagesView.tsx`), PANEL lateral `chatOpen`/`SocialPanel.tsx` (abre sobre qualquer view), e Rooms como view separada (`components/rooms/RoomsView.tsx`). Grupos server (`chatGroups`) vs Rooms E2EE — o usuário vê dois conceitos de "chat de grupo".
3. **Notifications:** item da sidebar que abre o PAINEL (nunca uma view) enquanto Messages abre PÁGINA — dois padrões de navegação para "caixa de entrada".
4. **Dois composers de post:** `feed/CreatePostModal.tsx` (via "Create post" header + `mainView==='create'` auto-abre-e-fecha, `App.tsx:154-158`) E `feed/PostCreatorModal.tsx` (dentro de `GoonMatchFeed.tsx:41,1158`, com câmera/tags). O botão "Create" do topo e o "+ Create" do feed abrem flows DIFERENTES.
5. **Store:** sidebar → `mainView 'store'` → `StoreView` → `StoreTab`; MAS `gamesSubTab` inclui `'store'` no type (`App.tsx:163`) e ads do feed mandam `'store'` pra games; `StoreModal.tsx` (693 linhas) **nunca é importado** (órfão morto).
6. **Spy** (`hack_spy`) e **PC Domination** como dois itens de sidebar para o mesmo tema (hacks/remote).
7. **Configurações:** item da sidebar (modal) + Settings do dock (mesmo modal) + identidade em 3 peças: `IdentityModal.tsx`, `PasskeyManager` (usado em `App.tsx:2921`), `GoonMatchSettingsModal.tsx`.

### Trejeitos de UI a varrer (citados + achados)

- **Pill "Online" FAKE:** rodapé da sidebar mostra ponto verde + "Online" hardcoded (`SidebarNav.tsx:365-373`) independentemente do estado real — enquanto o pill de conexão logo acima pode estar gritando "RECONNECTING…" (`:305-315`). Contradição na mesma coluna.
- Label partida: header do brand renderiza "Create"+"post" soltos no texto do topo do app (audit print 1.0: `Skip to main content / goonMatch / Create / post / Home…`).
- `IdleOverlay` com `onExit={() => { }}` noop (`App.tsx:2916`) — controle decorativo.
- Toasts genéricos sem deeplink ("Post created" sem "View" — checar na fase 6).
- Nomes de status inconsistentes: "Online/Offline/RECONNECTING…/ONLINE" misturados (`PlayerRoster:93`, `UserProfileModal:124`, `GoonMatchSettingsModal:345`, `SidebarNav:312,371`).

### Skills a usar (instaladas no repo, `.agents/skills/`)

- `better-ui` (+ `surfaces.md`, `animations.md`, `enter-exit.md`, `icons.md`): radius concêntrico, alinhamento óptico, sombra vs borda, transições interruptíveis — **valores exatos do arquivo, não aproximações**.
- `better-layout`, `better-typography`, `better-colors`, `better-accessibility`, `better-writing`: rótulos, espaçamento, contraste, foco, microcopy.
- `better-interface` (consolida todos) + `interface-review`: auditoria final do diff da branch (scope = range `main...refactor/ui-consolidation` + dirty).

### Comandos do repo (gate em TODA task)

```bash
cd /i/goongrid
npm run lint        # esperado: "0 errors" (warnings pré-existentes ok)
npm run test        # esperado: todos os workspaces verdes (api 759+, desktop 435+, protocol 15)
npm run typecheck   # esperado: silencioso (0 "error TS")
cd apps/desktop && npx playwright test   # esperado: 12 passed (e2e/journeys.spec.ts + social.spec.ts)
```

---

## 2. IA-alvo (mapa da consolidação)

```
Sidebar/footer/dock leem TODOS de src/nav.ts (fonte única)

  Home        feed
  Play        games  (duel · babecock · idle clicker · ranks · patrol)  ← sem cards/decks/store aqui
  Cards       cards  (tabs: My cards · Decks · Collected)               ← UNIFICA gallery+games-cards+games-decks
  Chat        chat   (tabs: DMs · Groups · Rooms[SITE] · Notifications) ← unifica messages+panel+rooms+notif
  Store       store  (entrada única)
  Hacks       hacks  (tabs: PC domination · Spy[quando ativo])          ← unifica domination+spy
  [Settings modal | Account&Keys modal — um ponto de entrada cada]
```

- Rotas antigas **redirecionam** (deep links/back-forward não quebram): `gallery→cards`, `messages→chat`, `rooms→chat?tab=rooms`, `hack_spy→hacks?tab=spy`, `pc_domination→hacks`, `grid→play?tab=idle`, `create→abre composer (modal, sem view)`.
- O PAINEL lateral de chat (`SocialPanel` + `chatOpen`/`panelTab`) **MORRE**: vira a página `chat`. O botão do dock "Chat" → navega para `chat`. `DmMinimizedView` (canto) fica como bolha de conversa minimizada, mas o estado `chatOpen/panelTab` do App é substituído por `chatTab` local do ChatView.
- Rooms (SITE-only) = UMA aba do Chat, não um item de sidebar.

---

## 3. Phase 0 — Harness de prints + baseline (antes de mudar qualquer pixel)

**0.1 Script de captura** (~10 min)

Create: `apps/desktop/scripts/capture-ui.mjs` — abre o vite (config e2e já sobe vite na 5273 com sidecar), seed app via `e2e/helpers.ts::seedApp` extraído para função standalone, fotografa cada rota em 2 larguras:

```js
// Run: node scripts/capture-ui.mjs docs/ui/after   (ou -before)
import { chromium } from '@playwright/test'
const outDir = process.argv[2] || 'docs/ui'
const routes = ['#/', '#/games', '#/cards', '#/chat', '#/store', '#/hacks', '#/profile', '#/rooms']
const browser = await chromium.launch()
for (const w of [1280, 900]) {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } })
  await page.goto(`http://localhost:5273/`)
  await page.waitForSelector('[data-testid="gc-balance"], aside.desktop-sidebar', { timeout: 20000 })
  for (const r of routes) {
    await page.evaluate((h) => (location.hash = h), r)
    await page.waitForTimeout(900) // settle tab render
    const name = r.replace(/[#/]/g, '_') || 'home'
    await page.screenshot({ path: `${outDir}/${name}-${w}.png`, fullPage: false })
  }
  await page.close()
}
await browser.close()
console.log('captured →', outDir)
```

Pré-requisito: `seedApp` hoje é do e2e; exportar de `e2e/helpers.ts` uma função `async function seedForCapture(page)` (mesmo seed de identity+age+idle save) e importar nos dois. Se `#/cards`/`#/chat`/`#/hacks` ainda não existirem (IA nova), o baseline fotografa o equivalente antigo (`#/gallery`, `#/messages`, `#/pc_domination`) — a task mantém uma tabela `ROUTES_BEFORE`/`ROUTES_AFTER` no topo do script, chaveada por arg.
Verificação: `cd apps/desktop && node ../../node_modules/vite/bin/vite.js --port 5273 --strictPort` (background) → `node scripts/capture-ui.mjs docs/ui/before` → esperado `captured → docs/ui/before` + 16 PNGs (`ls docs/ui/before | wc -l` → `16`). Commitar só o script (PNGs vão para `docs/ui/` com `*.png` gitignored? **NÃO** — commitar os prints de `before/` e `after/` para o diff visual ser reviewável; adicionar `docs/ui/wip/` ao .gitignore para captures de trabalho).

**0.2 Teste de fumaça do harness** — criar `apps/desktop/e2e/capture.spec.ts`? Não: YAGNI. O gate do harness é o próprio script rodando limpo. Commit `chore(ui): screenshot harness for consolidation audit`.

---

## 4. Phase 1 — Fonte única de navegação (`src/nav.ts`)

**1.1 Modelo de navegação** (~15 min, TDD)

Create: `apps/desktop/src/nav.ts`:

```ts
import type { ComponentType } from 'react'
export type NavId = 'feed' | 'play' | 'cards' | 'chat' | 'store' | 'hacks' | 'settings' | 'account'
export interface NavItem {
  id: NavId
  label: string            // ONE word where possible (better-writing)
  icon: ComponentType<{ className?: string }>
  route: string            // canonical hash (#/play)
  badge?: 'chat' | 'store-hack' | null
}
/** Desktop sidebar list. Footer (mobile) filters a subset; dock maps to ids.
 *  All three read THIS — no more per-surface navItems arrays. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'feed',  label: 'Home',  icon: HomeIcon,      route: '#/feed' },
  { id: 'play',  label: 'Play',  icon: GamepadIcon,   route: '#/play' },
  { id: 'cards', label: 'Cards', icon: CardsIcon,     route: '#/cards' },
  { id: 'chat',  label: 'Chat',  icon: ChatIcon,      route: '#/chat', badge: 'chat' },
  { id: 'store', label: 'Store', icon: StoreIcon,     route: '#/store' },
  { id: 'hacks', label: 'Hacks', icon: HackIcon,      route: '#/hacks' },
]
export const NAV_TOOLS = [
  { id: 'settings', label: 'Settings', icon: SettingsIcon, action: 'settings' },
  { id: 'account',  label: 'Account',  icon: KeyIcon,      action: 'account' },
] as const
```

Testes: `apps/desktop/src/nav.test.ts` — ids únicos; exatamente um item por função; `chat` único badge de mensagens; nada de 'notifications'/'gallery'/'messages'/'rooms'/'grid'/'pc_domination'/'hack_spy'/'admin' na lista (admin só via deep link, como hoje).
RED: `npx vitest run src/nav.test.ts` (fails: no module) → GREEN ao criar. **Nota de marca:** "Porn Games" → "Play" e "Cards" (gallery) → "Collected" (aba) segue o pedido de simplicidade; manter "Porn Games" como H1 interno da view Play (a label do hub não precisa repetir o título da página — better-layout).

**1.2 Routing: canonical + aliases legados** (~15 min, TDD)

Modify: `apps/desktop/src/utils/routing.ts`. `ROUTE_VIEWS` vira `['feed','play','cards','chat','store','hacks','profile','game','admin']` e `ALIAS` ganha:

```ts
const ALIAS: Record<string, RoutedView> = {
  home: 'feed', duels: 'play', games: 'play', idle: 'play', grid: 'play',
  cards: 'cards', gallery: 'cards', deckbuilder: 'cards',
  messages: 'chat', dm: 'chat', rooms: 'chat', notifications: 'chat',
  domination: 'hacks', hack_spy: 'hacks', pc_domination: 'hacks',
}
```

`hashForView('cards')` → `#/cards`. Query de sub-aba (`?tab=rooms|spy|idle|decks|collected`) parseada em helper novo `tabFromHash(hash, allowed: string[], fallback)` + `setTabInHash`. Testes novos em `routing.test.ts` (cada alias legado resolve; tab round-trip). RED→GREEN.

**1.3 SidebarNav consome `nav.ts`** (~20 min)

Modify: `apps/desktop/src/components/home/SidebarNav.tsx` — substituir o array inline `:112-210` por `NAV_ITEMS.map` + handlers `onNavigate(id)` vindos do App; remover props condicionais de entrada (`onOpenStore`, `onOpenGallery`, `onOpenNotifications`, `onOpenChat`, `showRooms`, `onOpenHackView`) do contrato de nav (manter as que alimentam badges). Badges: `chat` = `pmUnreadCount + notifCount + roomsUnread?` (soma única). Collapse, brand, pílulas (fase 6), moedas permanecem. RTL: atualizar `SidebarNav.test.tsx` (pill de conexão continua) + novo teste "six nav items, in nav.ts order". App: `mainView` passa a ser derivado do routing canônico (`'cards'|'chat'|'hacks'|'play'…`) — o switch do App.tsx renomeia os branches (`messages→chat` etc.) SEM mover JSX ainda (Phase 2/3 movem).

**1.4 HomeFooter + RightUtilityDock consomem nav.ts** (~15 min)

`HomeFooter.tsx` (mobile): `const navItems = NAV_ITEMS.filter(...)`, mesmas labels/rotas. `RightUtilityDock`: remover o botão Chat-duplicado (dock = apenas notificações-per-chat? não: dock mantém Players/Settings; "Chat" vira `onNavigate('chat')`). Gate: lint/test/typecheck + e2e `navigation round-trip`/`browser back/forward` verdes (ajustar selectors `Porn Games`→`Play` nos journeys). Commit por task: `feat(nav): single-source navigation (P1.x)`.

---

## 5. Phase 2 — Chat unificado (fim do painel lateral + Rooms como aba)

**2.1 `ChatView` com abas** (~25 min, TDD RTL)

Create: `apps/desktop/src/components/views/ChatView.tsx`:

```tsx
type ChatTab = 'dms' | 'groups' | 'rooms' | 'notifications'
// tabs: render existing components verbatim-first:
//   dms = <MessagesView panelTab="dms" .../> (sem a casca de página antiga)
//   groups = chatGroups list+GoonMatchDMs(group)  — já vive em MessagesView; mover JSX para cá
//   rooms = <RoomsView .../> (SITE mode only: hide tab when !courierActive)
//   notifications = <NotificationsPanel .../> (hoje painel)
```

Tab initial de `tabFromHash(hash, ['dms','groups','rooms','notifications'], 'dms')`; trocar aba atualiza o hash (`setTabInHash`, pushState) → back/forward funcionam. Header único com badge-count por aba. RTL novo `ChatView.test.tsx`: 4 tabs, rooms oculta fora de courier mode, hash `#/chat?tab=rooms` abre Rooms.

**2.2 Matar SocialPanel/chatOpen/panelTab** (~25 min)

Modify `App.tsx`: deletar estado `chatOpen,panelTab` (`:164` e correlatos), o bloco de painel (`:2838 <SocialPanel`) e os handlers que abrem painel (dock, header). Todas as chamadas `onToggleChat/setPanelTab` → `handleSetMainView('chat')` (+`tab` quando específico: `openChatTab('notifications')` = navegação+hash). `DmMinimizedView` fica (bolha flutuante), mas `dmMinimized` passa a ser derivado de `mainView!=='chat'`. `MessagesView`/`views/MessagesView.tsx` reduz ao conteúdo de dms+groups (a casca de página some — vira parte do ChatView).
Gates: `npm run test -w @goongrid/desktop` + e2e journey 3 (DM) com selectors `#/chat`.

**2.3 Rooms some da sidebar; Notifications idem** (~5 min) — já coberto por 1.3 (nav.ts não os lista); deletar props `showRooms`/`onOpenNotifications` do SidebarNav contract. `/#/rooms` legado → redirect (1.2). Commit `feat(chat): one chat surface (dm/groups/rooms/notifications tabs)`.

---

## 6. Phase 3 — Cards unificado (fim dos trios cards/decks/gallery)

**3.1 `CardsView` com abas** (~20 min, TDD)

Create: `apps/desktop/src/components/views/CardsView.tsx` com tabs `my | decks | collected`:
- `my`: grid das MINHAS cartas (conteúdo atual de `GamesHub` subTab `cards` — mover o bloco para cá; tile + empty-state com CTA "Upload a card" → abre `CreateCardModal`).
- `decks`: o `DeckBuilder` (era aba de games E bloco dentro de `GalleryTabView:86`) — uma única instância aqui.
- `collected`: o conteúdo de mídia recebida/enviada da `GalleryView` (filtros received/sent/starred, search, batch download/delete).

`GamesHub`: remover tabs `cards`/`decks` (e do type `GamesTab`); `initialSubTab==='store'`-hack do type some junto. Redirects de deep links: `#/cards?tab=decks` etc. (hash query, mesma máquina da fase 2). RTL `CardsView.test.tsx`: 3 tabs, cada uma renderiza o componente certo (mocks), nenhum link "decks" duplo sobra.

**3.2 Remover `GalleryTabView`** (~10 min) — o arquivo era só a costura gallery+deckbuilder; deletar (`git rm apps/desktop/src/components/views/GalleryTabView.tsx`), `GalleryView` e `DeckBuilder` ficam onde estão (componentes). App.tsx branch `mainView==='gallery'` → `cards`. `onOpenGallery`/`onOpenCollection` props → `onNavigate('cards', tab)`.

**3.3 Store única entrada** (~10 min) — `GamesTab`/`gamesSubTab` perde `'store'` (type `App.tsx:163`); `GoonMatchFeed` ad `mode==='store'` → `handleSetMainView('store')`; `onOpenStore` no store-view interno de GamesHub já era `handleSetMainView('store')`. Delete órfão: `git rm apps/desktop/src/components/StoreModal.tsx` (693 linhas, zero imports — re-verificar `grep -rn "StoreModal" apps/desktop/src | grep -v StoreModal.tsx` → vazio). Commit `feat(cards): one cards surface; delete orphan StoreModal`.

---

## 7. Phase 4 — Composer único WYSIWYG

**4.1 `PostComposer` = `CreatePostModal` absorve `PostCreatorModal`** (~30 min, TDD)

Compare as duas antes (`components/feed/CreatePostModal.tsx` 536L vs `PostCreatorModal.tsx` 271L): mover para CreatePostModal o que PostCreator tem a mais — input obrigatório de TAGS (componente do próprio arquivo), câmera (`onOpenCamera` já existe no app), multi-media; manter a UI/rascunho em `localStorage['goonmatch_draft']` (padrão repo). `GoonMatchFeed` para de renderizar `PostCreatorModal` (deletar import/uso `:41,:1158`) e o botão "+ Create" chama `setShowCreatePostModal(true)` (a mesma coisa que o header). `App.tsx:154-158`: o estado/view `'create'` **morre** (era "navegar para abrir um modal" — duas UIs; agora botão→modal direto, sem hash).
WYSIWYG: painel de preview vivo renderizando o POST COMO FICA NO FEED (avatar+caption+tags+media com o mesmo `ObjectImage`/`LinkifiedText` do feed) — componente novo `ComposerPreview.tsx`, testado por RTL (caption digitado aparece no preview; tag chips renderizam).

**4.2 CreateCardModal WYSIWYG** (~15 min) — preview atual já mostra a mídia (`CreateCardModal.tsx:163`); elevar a **CardBack real** (componente existe) sobre o preview, com tags/mimetype como no baralho. RTL: preview contém o texto da legenda/tags ao digitar.

**4.3 Feedback de composer** (~10 min) — submit desabilitado + motivo (`title`/aria), spinner no botão, toast de sucesso com ação "View" (deeplink ao post criado). Testar no RTL do modal.

---

## 8. Phase 5 — Hacks unificados + Admin/Account

**5.1 `HacksView` tabs** (~20 min, TDD): `apps/desktop/src/components/views/HacksView.tsx` com `domination | spy` (spy só visível com `activeHack` viva; deep link sem hack → volta pra domination com toast "No active hack"). `mainView 'pc_domination'/'hack_spy'` viram isto; sidebar/hacks via nav.ts. RTL dos tabs + oculto sem hack.

**5.2 Account & Keys num lugar** (~15 min): `IdentityModal` ganha um segundo tab "Passkeys" embutindo `PasskeyManager` (hoje injetado solto em `App.tsx:2921` dentro do módulo gallery — mover para o modal). Sidebar "Settings" (modal) + dock Gear → UM item só no rodapé da sidebar (`NAV_TOOLS`); dock perde o Settings duplicado. Gate e2e: jornada 6 (admin PIN) intacta (admin não é item de nav — deep link `#/admin` só, como hoje).

---

## 9. Phase 6 — Presença honesta + labels + polimento better-*

**6.1 `PresencePill` canônico** (~15 min, TDD)

Create `apps/desktop/src/components/PresencePill.tsx`:

```tsx
export type Presence = 'online' | 'reconnecting' | 'offline'
export function presenceOf(wsConnected: boolean, apiReachable: boolean): Presence {
  if (!apiReachable) return 'offline'
  return wsConnected ? 'online' : 'reconnecting'
}
// labels/vocabulário ÚNICOS (better-writing): Online · Reconnecting · Offline
// cor: emerald|amber|zinc (better-colors — token único, não 3 tons à escolha)
// dot 1.5 + text 10px mono, mesmo componente em: sidebar footer (mata o
// "Online" hardcoded :365-373), UserProfileModal, PlayerRoster, settings.
```

Substituir nos 5 call-sites; sidebar passa a ter UM pill (o de conexão, `:305-315`) com presença do USUÁRIO no footer derivada do MESMO estado (era fake verde). RTL: `presenceOf` + footer não diz "Online" com ws desligado.

**6.2 Label sweep** (~15 min) — rodar os `better-*` como checklist e corrigir no que achar:
- "Create post" partido no header (texto solto "Create"+"post") → botão único "Create post" com ícone (ver `HeaderAnnouncement`/brand block; grep `'Create'` nos textos do shell).
- Terminologia única por domínio (ex.: "Cards" nunca "Gallery"/"Collection" no label visível; "Chat" nunca "Messages").
- Numerais: `tabular-nums` em g$/badges; elos de unidade `g$ 1.234` (better-typography).
- `IdleOverlay onExit={() => { }}` — dar ação real (dismiss) ou remover o overlay (YAGNI): decidir = remover, não há exit.
- Ícones com tooltip quando collapsed (padrão `title` já existente), aria-labels presentes (better-accessibility).

**6.3 Polição visual `better-ui` com prints** (~30 min por varredura): rodar `node scripts/capture-ui.mjs docs/ui/wip`, inspecionar as imagens (visão: eu + o `vision_analyze`/checar manualmente em `docs/ui/wip/*.png`) e aplicar em batches pequenos, citando a regra usada em cada commit:
- radius concêntrico (outer = inner + padding) em cards/modais/tabs;
- borda vs sombra: remover bordas que só dão profundidade (lista em `better-ui/surfaces.md`);
- transições interruptíveis nos tabs/hover com as curas exatas do skill (`cubic-bezier(0.2, 0, 0, 1)` etc.); stagger de entrada só em listas longas (feed).
Cada batch = um commit `polish(ui): <regra better-ui> — <telas>`.

**6.4 Auditoria das skills** — rodar `better-interface` (repo-scope) sobre os screens finais; findings → fix ou ticket no plano (máx 15, priorizado). Depois, na hora do PR, `interface-review` no range da branch.

---

## 10. Phase 7 — Passe a limpo (o "tude")

**7.1 Sweeps de consistência** (~20 min): um grep-gate por regra (todos devem sair VAZIOS):

```bash
cd /i/goongrid && grep -rn "chatOpen\|setChatOpen\|panelTab" apps/desktop/src --include="*.tsx" --include="*.ts" | grep -v test
grep -rn "mainView === 'messages'\|'pc_domination'\|'hack_spy'\|'gallery'\|mainView === 'grid'" apps/desktop/src/App.tsx
grep -rn "PostCreatorModal\|ShowCustomPostCreator\|showCreatePostModal.*create" apps/desktop/src --include="*.tsx" | grep -v test
grep -rn ">Online<\|Online</span>" apps/desktop/src --include="*.tsx" | grep -v PresencePill | grep -v test
grep -rn "StoreModal" apps/desktop/src; grep -rn "IDLE CLICKER" apps/desktop/src
```

**7.2 Docs** (~10 min): `docs/SPEC.md` §7 (UI) ganha a tabela de IA final + mapa de redirects; README "screenshots" apontando `docs/ui/after/`.
**7.3 Prints finais** `docs/ui/after/` (rota nova) + `docs/ui/before/` commitados; PR com o lado-a-lado no body.
**7.4 Gate final**: lint 0 · typecheck 0 · `npm run test` verde · `npx playwright test` 12/12 · `npm run build` ok · smoke manual do `npm run electron`: navegar por 6 itens da sidebar, trocar abas com back/forward, compor post (preview ao vivo), card (CardBack), chat 4 abas, store, hacks. Merge `--no-ff` em `main` quando a branch courier dela estiver integrada.

---

## 11. Testes/validação (resumo por fase)

| Gate | Comando | Esperado |
|---|---|---|
| Unit RTL novo | `npx vitest run src/nav.test.ts src/components/views/ChatView.test.tsx src/components/views/CardsView.test.tsx src/components/rooms/RoomsView.test.tsx src/components/PresencePill.test.tsx src/components/feed/ComposerPreview.test.tsx` | todos passed |
| Routing legado | `npx vitest run src/utils/routing.test.ts` | aliases antigos todos redirecionando |
| E2E completo | `cd apps/desktop && npx playwright test` | `12 passed` (selectors atualizados p/ labels novas em journeys 2,3,5,8) |
| Prints | `node scripts/capture-ui.mjs docs/ui/after` | 16 PNGs, sem estado vazio sem CTA |
| Gates de grep (7.1) | lista acima | SAÍDA VAZIA |

TDD por task: teste primeiro (RED), implementação mínima (GREEN), commit — sem exceção; as tasks de remoção (StoreModal, SocialPanel, GalleryTabView) começam pelo grep que prova zero uso + teste de render da substituta ANTES do `git rm`.

## 12. Riscos / tradeoffs / aberto

1. **E2E frágil a labels** — toda mudança de texto exige passar nos journeys (são o contrato). Manter renomeio de label em commit separado do renomeio de rota para o diff ser legível.
2. **Estado global do App.tsx (~3.9k linhas)** — fases 2/3 são as de maior risco de regressão; fazer por fatia com smoke `npm run electron` entre commits.
3. **Deep links externos** (share `/p/:id`, `/u/:id`) não mudam; só os hashes internos têm alias. Redirects legados ficam ≥2 releases.
4. **`'game'`** (tela de partida) e **`'grid'`** (idle) permanecem views internas alcançáveis por fluxo/aba — não viram itens de nav (YAGNI); quem precisa, chega por Play/`#/play?tab=idle`.
5. **Groups vs Rooms** no Chat: conceitos distintos (server vs E2EE) — UI unifica a entrada, a SEMÂNTICA fica explícita em um hint da aba ("Rooms are end-to-end: the server can't read them"). Não fundir os dados.
6. **Aberto (decidir na task, não agora):** footer mobile deve virar bottom-bar com 4 itens (feed/play/chat/profile) + "mais"? — propor em 1.4, mas se sobrar tempo deixar footer atual lendo nav.ts.
7. **Prints no commit** incham o repo (~2MB) — aceito para review visual; wip/ gitignorado.
