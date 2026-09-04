// Shared booru/image-API provider config consumed by both the API
// (apps/api/src/bot-image-api.ts) and the admin UI
// (apps/web/src/components/admin/BotSetupPanel.tsx).

export type ProviderType = 'rule34' | 'gelbooru' | 'danbooru' | 'waifu_im' | 'nekos_best' | 'safebooru' | 'e621' | 'generic';

export type BotActivationRule = 'immediate' | 'fallback' | 'manual_only' | 'disabled';

export interface BotApiProvider {
  id: string;
  name: string;
  providerType: ProviderType;
  url: string;
  apiKey?: string;
  userId?: string;
  customHeaders?: Record<string, string>;
  tags: string[];
  enabled: boolean;
  weight?: number;
}

export interface BotConfig {
  providers: BotApiProvider[];
  names: string[];
  enabled: boolean;
  // Bot activation + fallback behaviour
  activationRule?: BotActivationRule;
  fallbackSeconds?: number;
  models?: string[];
  // Starter card tags filter for newcomer deck generation
  starterTags?: string[];
  // Legacy / fallback fields
  apiUrl?: string;
  apiKey?: string;
  userId?: string;
  tags?: string[];
}

export interface ApiTestResult {
  ok: boolean;
  status: number;
  statusText: string;
  latencyMs: number;
  foundCount: number;
  sampleUrls: string[];
  rawResponse: string;
  logs: string[];
  error?: string;
}

/**
 * A persistent bot duelist identity, editable by admins via /api/admin/bots.
 * The picture is resolved from the bot's own search tags against the
 * configured booru providers, or set manually by an admin.
 */
export interface BotProfileRecord {
  id: string;
  name: string;
  tags: string[];
  pfp_url?: string | null;
  color?: string | null;
  enabled: boolean;
  sort_order: number;
}

export const DEFAULT_BOT_NAMES = [
  'Aria',
  'Chrono',
  'Eclipse',
  'Valkyrie',
  'Sol',
  'Nyx',
  'Kitsune',
  'Raven',
  'Zenith',
  'Nova',
  'Mirage',
  'Kestrel',
  'Cipher',
  'Lyra',
  'Orion',
];

export const DEFAULT_BOORU_PROVIDERS: BotApiProvider[] = [
  {
    id: 'prov_rule34',
    name: 'Rule34 API (Verified)',
    providerType: 'rule34',
    url: 'https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1',
    apiKey: '521ffd9846555eb2718cf5a22a46b58e5528107c63dd207f77d8b8edcbc962ccfb02194b9dc4284490c846f42b72c90e520993dfe84e097e37d2d15c2823c5a6',
    userId: '2027820',
    tags: ['highres', 'rating:explicit', 'solo', 'uncensored'],
    enabled: true,
    weight: 12,
  },
  {
    id: 'prov_gelbooru',
    name: 'Gelbooru API',
    providerType: 'gelbooru',
    url: 'https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1',
    apiKey: '1727bcc6bda02c7bf12ad67c90dc7104120d2aa19d768af899ad59276a0b1058c113ecb402ee51f435a95ba5f063c9bc423f6e84d366d60320088dcf93157d79',
    userId: '2035666',
    tags: ['1girl', 'scenery', 'highres', 'game_cg'],
    enabled: true,
    weight: 10,
  },
  {
    id: 'prov_safebooru',
    name: 'Safebooru (Keyless)',
    providerType: 'safebooru',
    url: 'https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1',
    apiKey: '',
    userId: '',
    tags: ['1girl', 'solo', 'wallpaper', 'scenery'],
    enabled: true,
    weight: 10,
  },
  {
    id: 'prov_waifu_im',
    name: 'Waifu.im (Keyless)',
    providerType: 'waifu_im',
    url: 'https://api.waifu.im/search',
    apiKey: '',
    userId: '',
    tags: ['waifu', 'maid', 'uniform', 'marin-kitagawa', 'raiden-shogun'],
    enabled: true,
    weight: 9,
  },
  {
    id: 'prov_nekos_best',
    name: 'Nekos.best (Keyless)',
    providerType: 'nekos_best',
    url: 'https://nekos.best/api/v2/neko',
    apiKey: '',
    userId: '',
    tags: ['neko', 'waifu', 'kitsune'],
    enabled: true,
    weight: 8,
  },
  {
    id: 'prov_danbooru',
    name: 'Danbooru API',
    providerType: 'danbooru',
    url: 'https://danbooru.donmai.us/posts.json',
    apiKey: '',
    userId: '',
    tags: ['1girl', 'solo', 'highres', 'aesthetic'],
    enabled: true,
    weight: 6,
  },
];

export function detectProviderType(url: string): ProviderType {
  const lower = url.toLowerCase();
  if (lower.includes('rule34.xxx')) return 'rule34';
  if (lower.includes('gelbooru.com')) return 'gelbooru';
  if (lower.includes('danbooru.donmai.us')) return 'danbooru';
  if (lower.includes('safebooru.org')) return 'safebooru';
  if (lower.includes('e621.net')) return 'e621';
  if (lower.includes('waifu.im')) return 'waifu_im';
  if (lower.includes('nekos.best')) return 'nekos_best';
  return 'generic';
}
