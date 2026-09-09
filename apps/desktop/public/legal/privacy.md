# Política de Privacidade (LGPD/GDPR)

_Versão vinculante (PT-BR)_: **2026-09-09.1** · atualizado/updated: 2026-09-09
Jurisdição: LGPD (Lei 13.709/2018); GDPR para usuários da UE

## 1. Quem é o controlador

Para o SITE OFICIAL (carteiro cego + TURN): os mantenedores do repositório 9matesu/goongrid, contato via GitHub do projeto. Para FULL-NODES: o administrador daquele servidor é o controlador dos dados que nele existem; o software apenas implementa o que o host rodou.

## 2. Base legal

Execução de contrato (entregar o serviço que você pediu) + legítimo interesse (segurança/anti-abuso) + consentimento (ao aceitar os Termos e ao ativar funcionalidades opcionais como upload).

## 3. O que NÃO coletamos (declaração de minimização)

- Nada de conteúdo: o carteiro oficial recebe apenas envelopes cifrados (XChaCha20-Poly1305) e o endereço de entrega = hash BLAKE3 da sua chave pública. Ele não sabe quem envia, o que, nem quando você leu.

- Nada de presença: o modo site não expõe quem está online, grafo social, perfis ou posts.

- Nada de IP: pedidos de credencial TURN usam identidade aleatória efêmera por sessão; logs de servidor registram IP redigido (último octeto cortado).

- Nada de telemetria: o aplicativo não faz nenhuma requisição de analytics, crash report ou beacon para terceiros.

- Nada de cookies: o software desktop não usa cookies; não há rastreadores.

- Nada no disco do usuário além da sessão: imagens ficam SOMENTE em memória (cache RAM expirável ao fechar); chaves e histórico ficam cifrados pelo DPAPI do Windows; respostas HTTP de conteúdo usam Cache-Control: no-store.

## 4. O que É tratado, e por quem

- **Site oficial:** endereço de entrega (hash), tamanho dos envelopes, timestamps, TTL/limite por caixa (anti-flood). Finalidade: rotear. Retenção: até 7 dias (expiração) ou imediato após ack assinado.

- **Sua máquina:** identidade completa, chaves, threads, salas, configurações, save do jogo. Nunca sobem ao site.

- **Full-node (se você usar):** ali existem postagens, perfis, DMs legadas (criptografadas com chave do SERVIDOR — o host consegue ler), economias e logs administrativos. Verifique a política do seu host.

## 5. Direitos do titular (art. 18 LGPD / arts. 15-22 GDPR)

Confirmação, acesso, correção, portabilidade, eliminação e revogação de consentimento exercita-se LOCALMENTE: exporte sua identidade no app (portabilidade) e apague-a (eliminação no seu dispositivo); no modo correio, seus envelopes expiram sozinhos sem intervenção. Para o site oficial, como os dados são apenas hashes e bytes cifrados, não há como associá-los a você — eliminação já está embutida na arquitetura. Para full-nodes, fale com o administrador do host.

## 6. Segurança

Assinatura Ed25519 em mutações com nonce anti-replay; ECIES (X25519 + XChaCha20-Poly1305 + BLAKE3 KDF); credenciais TURN HMAC de vida curta; validação de forma sem leitura de conteúdo; CSP estrita; sanitização de candidatos ICE que vazariam seu IP (mDNS/relay). Auditoria completa pública em docs/SECURITY-AUDIT.md no repositório.

## 7. Transferências internacionais e subprocessadores

O site oficial pode estar hospedado em nuvem fora do Brasil; o único dado processado por ela são envelopes opacos e hashes, sem chave de decifragem. Há TURN auto-hospedado; não usamos redes de terceiros para conteúdo.

## 8. Menores

O serviço é para maiores de 18 anos. Não coletamos dados de menores intencionalmente; não há verificação de idade.

## 9. Alterações

Alterações substanciais desta política exigem novo aceite no aplicativo. Versão atual: indicada acima e na tela do Centro Legal.
