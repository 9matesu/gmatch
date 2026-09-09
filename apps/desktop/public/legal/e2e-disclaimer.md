# Declaração sobre Criptografia e Autocustódia

_Versão vinculante (PT-BR)_: **2026-09-09.1** · atualizado/updated: 2026-09-09
Jurisdição: Explicação técnica vinculada ao art. 8 dos Termos

## 1. O que o servidor oficial NUNCA vê

Conteúdo de DMs, posts, salas ou nomes; quem conversa com quem (o carteiro roteia hashes, você conecta seu ID à sua caixa localmente); quem está online; a sua imagem, seu texto, seu histórico.

## 2. O que ele vê

O endereço de entrega (hash da sua chave pública) com metadados mínimos (tamanho, hora, TTL) e pedidos anônimos de credencial TURN.

## 3. Chaves: o que autocustódia significa

Suas chaves privadas vivem apenas no seu dispositivo (cifradas pelo DPAPI do Windows quando disponível). Não há servidor com "esqueci minha senha". Quem perde o backup perde a conta — sem exceção.

## 4. TOFU (web-of-trust por primeira aparição)

Ao cifrar a primeira conversa, o app FIXA a chave pública do contato. Se a chave mudar, você é avisado explicitamente antes de enviar. Não há diretório de identidade confiável a auditar — a verificação fora do app (por exemplo, conferir o hash num canal que ambos confiam) é a única defesa contra homem-no-meio de troca de chave.

## 5. Limites honestos

- Metadados temporais do carteiro podem correlacionar tráfego sob vigilância forte (não há padding/onion por padrão).

- Um full-node de terceiros tem o poder de ler o que passar por ele (modelo "o host É o servidor").

- Malware rodando como o seu usuário de sessão pode ler dados em memória — proteção é do seu ambiente.

## 6. Sem suporte de recuperação

Pedidos de suporte do tipo "redefina minha conta" são recusados por princípio: não temos como cumpri-los sem quebrar a promessa deste documento.
