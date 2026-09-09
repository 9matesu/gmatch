# ADR-002 — Servers: diretório público + federação de nós

Data: 2026-09-09 · Status: aceito · Plano: `.hermes/plans/2026-09-09_161233-ponytail-encrypted-api-servers.md`

## Decisão

1. **Servidor = full node.** O app já sabe HOSTEAR a API (bundle electron, `server-mode.cjs`) e já sabe CONECTAR como client a um servidor remoto. "Criar um servidor" = modo host + registrar-se no diretório; "entrar" = modo client apontando para o endpoint do host. Nenhum mecanismo novo de transporte.
2. **Diretório fica SÓ no central** (`/api/servers`), com allow-list no gate `SITE_SERVICES`. Contém apenas: id (hash do registro), nome, descrição ≤200 chars, orbitId+pubkey do dono, hint de endpoint, flag `password_required`, timestamps. O central **não vê conteúdo nem usuários** de nenhum servidor — e não pode, porque cada nó é um SQLite independente na máquina do dono.
3. **Dono = admin do próprio nó.** Registro no diretório exige assinatura Ed25519 da identidade do dono; o primeiro unlock de admin do nó é feito pelo PIN gerado no boot (exibido localmente no ServerTab → exportado para o dono), reusando a suíte `is_admin` + `admin.ts` + `AdminApp` existente sem alterações de modelo.
4. **Senha de entrada é verificada NO HOST** (PBKDF2/scrypt + lockout 5/15min reusando o mecanismo de B.4), nunca no central. O token de entrada (`join_token`, HMAC com a STORAGE key do host, 30d) fica no **KV DPAPI** do cliente.
5. **Dashboard/userlist vem do próprio nó** (`GET /api/servers/dashboard`): nome, integrantes (id truncado + display_name + boolean online na janela de 60s já usada pelos hacks), posts 24h. Servidores remotos no diretório NÃO expõem userlist ao central — isso seria conteúdo; a lista aparece somente quando você está conectado àquele nó.

## Consequências / limites honestos

- "Todo player guarda um pedaço do servidor": nesta versão, **não**. Disponibilidade = host online. Suplentes só via **export/import manual de snapshot** pelo admin (rota nova `/api/admin/export-snapshot` reusando `snapshotDb`). Replicação automática multi-réplica (estilo swan/BT) é projeto de pesquisa à parte — registrado como NÃO-feito.
- "Novo player entra sem transferência → servidor vazio" é o comportamento esperado de um diretório: o conteúdo nunca esteve no central; entra-se no nó do host que já tem os dados, ou num nó vazio recém-criado.
- `endpoint_hint` não resolve NAT: criar servidor atrás de CGNAT permanece não-joinável de fora (a UI avisa; port-forwarding é do usuário).
- Servidor privado com senha: metadados do diretório (nome/dono) são públicos por design — se o dono quer lista privada, é host-and-share-fora-de-band, não diretório.
