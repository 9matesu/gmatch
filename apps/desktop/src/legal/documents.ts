/**
 * Canonical legal documents (security plan Phase C / "blindagem jurídica").
 * SINGLE SOURCE OF TRUTH: the in-app LegalCenter, the CLI download (.md via
 * scripts/gen-legal.mjs) and the public site legal pages ALL render from
 * these strings — drift is impossible by construction, and CI fails if the
 * generated .md files are stale.
 *
 * PT-BR is the binding text; EN mirrors are informational (documents.en.ts).
 * Each doc: version = date + bump counter (acceptance is keyed to the FULL
 * version map, so any doc bump re-gates every logged-in user).
 */

export type LegalId = 'terms' | 'privacy' | 'community' | 'abuse' | 'records' | 'e2e-disclaimer'

export interface LegalDoc {
  id: LegalId
  title: string
  version: string
  updated: string
  jurisdiction: string
  /** Markdown-ish sections: '## heading' lines start a section; '-' bullet. */
  body: string[]
}

export const LEGAL_VERSION = '2026-09-09.1'

export const LEGAL_DOCS: Record<LegalId, LegalDoc> = {
  terms: {
    id: 'terms',
    title: 'Termos de Uso',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'Brasil (LGPD) — usuários internacionais também sujeitos ao GDPR onde aplicável',
    body: [
      '## 1. Elegibilidade e idade',
      'O goonMatch Grid é um aplicativo para adultos. Você deve ter pelo menos 18 anos (ou a maioridade na sua jurisdição, se superior) para acessar, baixar ou usar o software. Ao aceitar estes Termos você declara e garante que cumpre esse requisito. Não fazemos verificação de idade: a declaração é sua, e a falsidade dela é responsabilidade sua.',
      '## 2. O que é o software',
      'O goonMatch Grid é um software de código aberto, auto-hospedável, para rede social adulta com jogabilidade (cartas, duelo, sala de ocioso) e comunicação ponto a ponto com criptografia de ponta a ponta. Quem distribui o binário fornece o SOFTWARE; não administra, não edita e não hospeda o conteúdo que você publica ou troca.',
      '## 3. Conta, chaves e autocustódia',
      '- Sua conta é um par de chaves criptográficas gerado e mantido NO SEU DISPOSITIVO.',
      '- Ninguém — nem os autores do software — pode redefinir sua senha, recuperar sua conta ou acessar seus dados sem a sua chave.',
      '- Perdeu o backup da chave? A conta e o histórico local estão perdidos. Isto é um recurso de privacidade, não um defeito, e não há suporte que o reverta.',
      '- Você é o único responsável por guardar suas chaves e por manter seu dispositivo seguro.',
      '## 4. Modos de operação e confiança',
      'O app funciona em dois modos com modelos de confiança diferentes:',
      '- **Site oficial / correio (courier):** o servidor público funciona apenas como carteiro cego. Ele encaminha envelopes cifrados que NÃO consegue abrir e nunca vê conteúdo, identidade de conversa, presença ou grafo social.',
      '- **Full-node (servidor próprio ou de terceiros):** você conecta a um servidor completo que VOCÊ (ou quem o hospeda) administra. Nesse modo, o administrador do servidor pode ler mensagens privadas legadas e dados de post conforme a arquitetura descrita na Política de Privacidade. Conectar-se ao full-node de um terceiro é escolha sua e cria uma relação de confiança entre você e esse host.',
      '## 5. Conduta',
      'É proibido usar o software para: conteúdo ilegal (incluindo material de abuso sexual infantil, conteúdo envolvendo menores ou pessoas que não possam consentir, zoofilia, incesto real não-consensual e violência não-consensual); assédio, stalking ou intimidação; spam ou automação abusiva; tentativa de desanonimizar outros usuários; exploração do sistema de reputação/moeda para fraude.',
      'O cliente aplica uma lista técnica de bloqueio de tags de conteúdo. Isso é mitigação, não garantia: o controle final do que entra no seu dispositivo é seu.',
      '## 6. Conteúdo do usuário e licenças',
      'Você mantém a titularidade do que publica. Ao publicar, você concede aos demais usuários a licença pessoal, não-exclusiva e revogável de visualizar o conteúdo DENTRO do aplicativo, e aos destinatários de DMs a licença de armazenar cópias locais (o app não controla o que um receptor faz com o que recebeu — não existe DRM de ponta a ponta que o faça).',
      'Você declara que tem o direito de publicar o que envia (inclusive autorizações das pessoas retratadas quando a lei exigir).',
      '## 7. Encerramento',
      'Você pode sair a qualquer momento: apague o aplicativo e a conta desaparece do seu lado; no modo correio, envelopes não consumidos expiram por TTL e somem. Não podemos "excluir você de um servidor" que não é nosso nem apagar dados que nunca tivemos.',
      '## 8. Limitação de responsabilidade',
      'O software é fornecido "no estado em que se encontra", sem garantias de qualquer tipo, na máxima extensão permitida pela lei brasileira. Os autores e distribuidores NÃO respondem por: (a) conteúdo gerado ou compartilhado por usuários; (b) perda de dados por falha de backup do usuário; (c) indisponibilidade ou mau funcionamento de servidores de terceiros; (d) danos indiretos, lucros cessantes ou conteúdo ofensivo visto em full-nodes de terceiros. Em nenhuma hipótese a responsabilidade dos autores excede o valor pago pelo software (zero).',
      '## 9. Alterações',
      'Estes Termos têm versão publicada (acima). Alterações substanciais exigirão novo aceite no aplicativo da sua conta no próximo login após a mudança. A versão aceita fica registrada localmente.',
      '## 10. Foro e lei aplicável',
      'Estes Termos são regidos pela legislação da República Federativa do Brasil. Fica eleito o foro da comarca do domicílio do usuário para controvérsias, respeitados os direitos do consumidor.',
    ],
  },

  privacy: {
    id: 'privacy',
    title: 'Política de Privacidade (LGPD/GDPR)',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'LGPD (Lei 13.709/2018); GDPR para usuários da UE',
    body: [
      '## 1. Quem é o controlador',
      'Para o SITE OFICIAL (carteiro cego + TURN): os mantenedores do repositório 9matesu/goongrid, contato via GitHub do projeto. Para FULL-NODES: o administrador daquele servidor é o controlador dos dados que nele existem; o software apenas implementa o que o host rodou.',
      '## 2. Base legal',
      'Execução de contrato (entregar o serviço que você pediu) + legítimo interesse (segurança/anti-abuso) + consentimento (ao aceitar os Termos e ao ativar funcionalidades opcionais como upload).',
      '## 3. O que NÃO coletamos (declaração de minimização)',
      '- Nada de conteúdo: o carteiro oficial recebe apenas envelopes cifrados (XChaCha20-Poly1305) e o endereço de entrega = hash BLAKE3 da sua chave pública. Ele não sabe quem envia, o que, nem quando você leu.',
      '- Nada de presença: o modo site não expõe quem está online, grafo social, perfis ou posts.',
      '- Nada de IP: pedidos de credencial TURN usam identidade aleatória efêmera por sessão; logs de servidor registram IP redigido (último octeto cortado).',
      '- Nada de telemetria: o aplicativo não faz nenhuma requisição de analytics, crash report ou beacon para terceiros.',
      '- Nada de cookies: o software desktop não usa cookies; não há rastreadores.',
      '- Nada no disco do usuário além da sessão: imagens ficam SOMENTE em memória (cache RAM expirável ao fechar); chaves e histórico ficam cifrados pelo DPAPI do Windows; respostas HTTP de conteúdo usam Cache-Control: no-store.',
      '## 4. O que É tratado, e por quem',
      '- **Site oficial:** endereço de entrega (hash), tamanho dos envelopes, timestamps, TTL/limite por caixa (anti-flood). Finalidade: rotear. Retenção: até 7 dias (expiração) ou imediato após ack assinado.',
      '- **Sua máquina:** identidade completa, chaves, threads, salas, configurações, save do jogo. Nunca sobem ao site.',
      '- **Full-node (se você usar):** ali existem postagens, perfis, DMs legadas (criptografadas com chave do SERVIDOR — o host consegue ler), economias e logs administrativos. Verifique a política do seu host.',
      '## 5. Direitos do titular (art. 18 LGPD / arts. 15-22 GDPR)',
      'Confirmação, acesso, correção, portabilidade, eliminação e revogação de consentimento exercita-se LOCALMENTE: exporte sua identidade no app (portabilidade) e apague-a (eliminação no seu dispositivo); no modo correio, seus envelopes expiram sozinhos sem intervenção. Para o site oficial, como os dados são apenas hashes e bytes cifrados, não há como associá-los a você — eliminação já está embutida na arquitetura. Para full-nodes, fale com o administrador do host.',
      '## 6. Segurança',
      'Assinatura Ed25519 em mutações com nonce anti-replay; ECIES (X25519 + XChaCha20-Poly1305 + BLAKE3 KDF); credenciais TURN HMAC de vida curta; validação de forma sem leitura de conteúdo; CSP estrita; sanitização de candidatos ICE que vazariam seu IP (mDNS/relay). Auditoria completa pública em docs/SECURITY-AUDIT.md no repositório.',
      '## 7. Transferências internacionais e subprocessadores',
      'O site oficial pode estar hospedado em nuvem fora do Brasil; o único dado processado por ela são envelopes opacos e hashes, sem chave de decifragem. Há TURN auto-hospedado; não usamos redes de terceiros para conteúdo.',
      '## 8. Menores',
      'O serviço é para maiores de 18 anos. Não coletamos dados de menores intencionalmente; não há verificação de idade.',
      '## 9. Alterações',
      'Alterações substanciais desta política exigem novo aceite no aplicativo. Versão atual: indicada acima e na tela do Centro Legal.',
    ],
  },

  community: {
    id: 'community',
    title: 'Regras da Comunidade',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'Aplicadas tecnicamente no cliente e por hosts de full-node',
    body: [
      '## 1. Idade e consentimento',
      '18+. Todo conteúdo deve retratar ou simular consentimento. Proibido: menores, aparentar menores, não-consensual, incesto real, bestialismo, morte/necrofilia, coerção real. A lista técnica de bloqueio (tags) vale para todos os feeds e uploads.',
      '## 2. Privacidade alheia',
      'Nunca publique imagem íntima de outra pessoa sem consentimento dela. Revenge porn é crime no Brasil (Lei 13.718/2018) e motivo de expulsão de qualquer full-node.',
      '## 3. Respeito',
      'Sem assédio, perseguição, discurso de ódio, tentativas de desanonimizar ("outing") ou caçar IP de outros usuários.',
      '## 4. Conteúdo gerado por IA',
      'Permitido, desde que não viole as regras 1-3 e não represente pessoa real sem consentimento.',
      '## 5. Moeda do jogo',
      'Economia interna (g$) não tem valor real, não é conversível, não é negociável fora do app. Explorar bugs = perda de saldo.',
      '## 6. Aplicações',
      'No modo correio oficial, NINGUÉM modera: não lemos o que você recebe. Suas ferramentas são bloqueio silencioso, exportação de chave (ver documento Abuso) e o filtro técnico do cliente. Em full-nodes, cada host aplica estas regras por conta própria.',
    ],
  },

  abuse: {
    id: 'abuse',
    title: 'Denúncias e Notice-and-Takedown',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'MGA 512 (EUA) como referência; LGPD/CC Brasil para remoção',
    body: [
      '## 1. O problema honesto do E2EE',
      'No modo correio oficial, NÃO LEEMOS conteúdo — e por isso NÃO PODEMOS moderar preventivamente, avaliar denúncia sobre o que não vimos, nem apagar de forma seletiva o que não armazenamos. Isto é deliberado.',
      '## 2. O que a arquitetura permite',
      '- **Divulgação de chave pela vítima:** quem recebeu um envelope pode exportar a chave DESSA conversa/sala. Com a chave pública da conversa + o envelope, um moderador humano pode abrí-lo e validá-lo contra a assinatura. Isso só é possível para conteúdo a que a vítima tem acesso.',
      '- **Endereço de entrega:** é público e verificável por quem tem a chave privada correspondente. Uma ordem judicial que identifique a chave-privada de um endereço de entrega pode, se cumprida pelo usuário, revelar seu conteúdo.',
      '- **Full-nodes:** o host pode ler o que você publica nele; denúncias vão ao host.',
      '## 3. Como denunciar',
      'Contato público no repositório. Envie: a) sua relação com o fato (vítima/procurador/interessado), b) descrição e, se possível, os envelopes e as chaves divulgadas, c) URL/identificador concreto (endereço de entrega), d) declaração sob pena de perjury de boa-fé.',
      '## 4. O que NÃO podemos atender',
      'Ordens genéricas de vigilância ("me mostre os usuários"), pedidos sem chave divulgada ou sem base legal, e remoção de conteúdo armazenado por terceiros após entrega — não controlamos os dispositivos de quem recebe.',
      '## 5. Transparência',
      'Receberemos ordens governamentais apenas conforme lei aplicável e as publicaremos em relatório de transparência se permitido; nenhuma chave de servidor oficial dá acesso a conteúdo de usuários porque o servidor nunca as teve.',
    ],
  },

  records: {
    id: 'records',
    title: 'Conteúdo Adulto e Registros (18 U.S.C. §2257 adjacente)',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'EUA (para quem publica conteúdo sexual explícito sob jurisdição dos EUA); análogas locais aplicáveis',
    body: [
      '## 1. Quem é o "publisher"',
      'No modelo courier/P2P, NÃO há editor central: quem envia é o publisher de seu conteúdo e o guardião de seus registros. Quem publica conteúdo sexual explícito nos EUA está sujeito à 18 U.S.C. §2257 e precisa manter registros de idade/identidade dos performers; fora dos EUA, leis análogas podem aplicar.',
      '## 2. Onde ficam os registros',
      'Com o publisher — no dispositivo dele. Os distribuidores do software não recebem, não veem e não armazenam seus registros. Não oferecemos serviço de custódia de registros e não devemos ser tratados como tal.',
      '## 3. Ferramentas do app',
      'O app registra localmente a data/hora e a chave do autor de cada envio (assinatura dentro do envelope cifrado) — evidência de proveniência que fica NA MÃO DE QUEM POSSUI A CHAVE, útil para você provar autoria/data.',
      '## 4. Isenção de aviso',
      'Nenhum aviso legal aqui autoriza conteúdo ilegal. A regra 1 do documento Comunidade prevalece: o software não pode ser usado para conteúdo com menores ou não-consentido sob qualquer lei.',
    ],
  },

  'e2e-disclaimer': {
    id: 'e2e-disclaimer',
    title: 'Declaração sobre Criptografia e Autocustódia',
    version: LEGAL_VERSION,
    updated: '2026-09-09',
    jurisdiction: 'Explicação técnica vinculada ao art. 8 dos Termos',
    body: [
      '## 1. O que o servidor oficial NUNCA vê',
      'Conteúdo de DMs, posts, salas ou nomes; quem conversa com quem (o carteiro roteia hashes, você conecta seu ID à sua caixa localmente); quem está online; a sua imagem, seu texto, seu histórico.',
      '## 2. O que ele vê',
      'O endereço de entrega (hash da sua chave pública) com metadados mínimos (tamanho, hora, TTL) e pedidos anônimos de credencial TURN.',
      '## 3. Chaves: o que autocustódia significa',
      'Suas chaves privadas vivem apenas no seu dispositivo (cifradas pelo DPAPI do Windows quando disponível). Não há servidor com "esqueci minha senha". Quem perde o backup perde a conta — sem exceção.',
      '## 4. TOFU (web-of-trust por primeira aparição)',
      'Ao cifrar a primeira conversa, o app FIXA a chave pública do contato. Se a chave mudar, você é avisado explicitamente antes de enviar. Não há diretório de identidade confiável a auditar — a verificação fora do app (por exemplo, conferir o hash num canal que ambos confiam) é a única defesa contra homem-no-meio de troca de chave.',
      '## 5. Limites honestos',
      '- Metadados temporais do carteiro podem correlacionar tráfego sob vigilância forte (não há padding/onion por padrão).',
      '- Um full-node de terceiros tem o poder de ler o que passar por ele (modelo "o host É o servidor").',
      '- Malware rodando como o seu usuário de sessão pode ler dados em memória — proteção é do seu ambiente.',
      '## 6. Sem suporte de recuperação',
      'Pedidos de suporte do tipo "redefina minha conta" são recusados por princípio: não temos como cumpri-los sem quebrar a promessa deste documento.',
    ],
  },
}

/** All version pairs for acceptance-key bookkeeping. */
export function legalVersionKey(): string {
  return Object.values(LEGAL_DOCS)
    .map((d) => `${d.id}@${d.version}`)
    .sort()
    .join(';')
}

export const LEGAL_IDS: LegalId[] = Object.keys(LEGAL_DOCS) as LegalId[]
