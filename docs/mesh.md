# Mesh — descoberta por tracker + gossip

Como dois peers em máquinas diferentes se encontram, o que o tracker vê, e o que
isto **não** protege.

## Fluxo

```
boot
 └─ infohash = sha1(HMAC(communityKey, "mesh:" + UTC day))     ← muda 1×/dia
     └─ announce nos trackers (wss), 3+ operadores em paralelo
         ├─ publicamos { offer_id, offer (SDP) }
         ├─ recebemos { offer_id, answer }  → setRemoteDescription
         └─ recebemos { offer_id, offer }   → respondemos com answer
             └─ DataChannel abre
                 └─ HELLO (2 fases) → transcript assinado
                     └─ PEX (lista de peers verificados, cap 32)
                         └─ SWARM_* (have/want/chunk) — bytes
```

## Formato do HELLO

```
payload   = { v, orbitId, pubKeyHex, encPubHex?, fp, nonce }
transcript = "mesh-hello-v1" | fp_local | fp_remote | nonce_local | nonce_remote
sig        = Ed25519(identity.priv, transcript)
```

Verificação (nesta ordem, tudo ou nada):

1. `orbitId === sha256(pubKeyHex)` — uma assinatura válida de outra conta não pega identidade emprestada;
6. `fp` = 64 hex, `nonce` = 32 hex;
3. `verifySignature(sig, transcript, pubKeyHex)`;
4. `fp_local` confere com o fingerprint DTLS real da sessão.

O fingerprint é lido do SDP (`a=fingerprint:sha-256`), ou seja, é o que o DTLS
realmente apresenta. Um tracker que troque o SDP quebra aqui.

## PEX

- Só peers **verificados** entram na tabela (um tracker malicioso não envenena).
- Máx. 32, mais recentes primeiro; poda 6 h.
- 1 PEX por peer por minuto (sem tempestade).
- `orbitId` é o identificador estável na tabela.

## Modelo de ameaça — o que é e o que não é

**É protegido:**
- **Conteúdo**: AEAD por chunk (XChaCha20-Poly1305), AAD liga objeto/transfer/índice/fetcher. O tracker nunca vê bytes.
- **Catálogo**: o tracker vê um infohash opaco que muda todo dia. Não vê nome, avatar, tags ou lista de arquivos.
- **Integridade da identidade**: o HELLO assinado impede um par impostor (mesmo que o tracker aponte para ele).

**NÃO é protegido:**
- **IP**: o tracker e os peers veem seu IP. Isso é inerente a WebRTC com STUN.
- **Correlação de identidade**: `orbitId` é persistente no PEX — a mesma pessoa é reconhecível entre sessões (pseudônimo, não anonimato).
- **Volume/tamanho**: o tracker aprende que você está online e, indiretamente, a janela de horário.
- **Chave padrão é pública**: `gmatch-open-mesh-v1` está no código. Serve contra enumeração casual e blocklist estático, **não** contra quem lê o bundle. Para fechar, use uma chave de convite.

## Configuração

`Settings → Preferences → Mesh discovery`:

- **Mesh discovery** (on/off) — off = nenhum anúncio, nenhum tráfego de tracker.
- **Community key** — 16-64 em `[A-Za-z0-9_-]`. Valida no blur; ao trocar, **re-announce imediato** (`gmatch:mesh-reannounce`) no infohash novo.
- **Hide which files I hold** — `SWARM_HAVE_SUMMARY` com `count` em vez de ids (quando ligado).

Trackers padrão (configuráveis): `tracker.openwebtorrent.com`, `tracker.btorrent.xyz`,
`tracker.webtorrent.dev`. STUN: Cloudflare, Google ×2, Twilio.

## Riscos conhecidos

- **Tracker público cai sem aviso**: 3+ na lista, backoff limitado, o resto segue.
- **NAT simétrico dos dois lados**: o par aparece no PEX, mas não há caminho direto. A UI diz "não alcançável" — não finge conexão.
- **Cold start**: sem tracker e sem PEX, a malha só cresce por convite/código de nó.
- **SDP higienizado**: o `ice-hygiene` remove candidatos de IP literal (mDNS). Se um tracker/pair exigir candidatos que a higiene corta, o hole punching falha — só aparece fora do localhost.

## Não testado (registrado, não escondido)

- NAT simétrico real / CGNAT.
- Handshake contra trackers que exijam `offer_id` no formato exato (a maioria aceita o nosso; validar em produção).
- E2E de 3 processos com PEX (unit cobre a tabela; a integração real depende de trackers vivos).