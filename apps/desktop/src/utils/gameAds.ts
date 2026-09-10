import type { FeedPost } from '../components/feed/GMatchFeed';

export type GameMode = 'duel' | 'babecock' | 'ranks' | 'store' | 'discord' | 'coffee';

export interface GameAdTemplate {
  mode: GameMode;
  gameName: string;
  tagline: string;
  ctaLabel: string;
  gradient: string;
  icon: string;
  badge: string;
}

export interface SponsoredFeedPost extends FeedPost {
  is_sponsored: true;
  game_mode: GameMode;
  players_playing: number;
  cta_label: string;
}

export const GAME_AD_TEMPLATES: GameAdTemplate[] = [
  {
    mode: 'discord',
    gameName: 'Official Discord',
    tagline: 'Join our community server, meet other creators, and get live updates.',
    ctaLabel: 'Join Our Discord',
    gradient: 'from-[#5865F2] via-[#7289da] to-[#4752C4]',
    icon: 'discord',
    badge: 'COMMUNITY',
  },
  {
    mode: 'coffee',
    gameName: 'Buy Me A Coffee',
    tagline: 'Support gMatch development and unlock exclusive supporter badges & perks.',
    ctaLabel: 'Buy a Coffee',
    gradient: 'from-amber-400 via-yellow-500 to-amber-600',
    icon: 'coffee',
    badge: 'SUPPORT US',
  },
  {
    mode: 'duel',
    gameName: 'Card Duel Arena',
    tagline: 'Deploy your deck. Climb the league. Crush your rivals.',
    ctaLabel: 'Enter the Arena',
    gradient: 'from-[#f09433] via-[#dc2743] to-[#bc1888]',
    icon: 'duel',
    badge: '1v1 DUELS LIVE',
  },
  {
    mode: 'babecock',
    gameName: 'Babecock',
    tagline: 'The legendary arena showdown. Speed rounds, hot streaks.',
    ctaLabel: 'Start a Session',
    gradient: 'from-amber-400 via-orange-500 to-rose-600',
    icon: 'babecock',
    badge: 'LIVE NOW',
  },
  {
    mode: 'ranks',
    gameName: 'Rankings',
    tagline: 'Climb the global leaderboard. Only the obsessed stay on top.',
    ctaLabel: 'See the Standings',
    gradient: 'from-yellow-400 via-amber-500 to-orange-600',
    icon: 'ranks',
    badge: 'SEASON 7',
  },
  {
    mode: 'store',
    gameName: 'Arcade Store',
    tagline: 'Unlock exclusive cards, powerups and legendary loot. Limited drop.',
    ctaLabel: 'Open the Store',
    gradient: 'from-violet-500 via-purple-600 to-fuchsia-700',
    icon: 'store',
    badge: 'NEW DROP',
  },
];

export function pickRandomTemplate(seed: number): GameAdTemplate {
  const idx = Math.abs(Math.floor(seed)) % GAME_AD_TEMPLATES.length;
  return GAME_AD_TEMPLATES[idx];
}

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const IDS = ['post_ad_discord', 'post_ad_coffee', 'post_ad_duel', 'post_ad_babecock', 'post_ad_ranks', 'post_ad_store'];

export function buildSponsoredPost(seed: number): SponsoredFeedPost {
  const template = pickRandomTemplate(seed);
  const players = 340 + Math.floor(seededRandom(seed + 7)() * 2480);
  return {
    id: `${IDS[GAME_AD_TEMPLATES.indexOf(template)]}_${seed}`,
    author_id: 'gMatch_ads',
    author_name: 'gMatch Arcade',
    author_avatar: null,
    url: '',
    caption: `${template.tagline} #${template.badge.toLowerCase().replace(/[^a-z0-9]+/g, '')}`,
    location: 'gMatch Arcade',
    tags: ['sponsored', 'games', template.mode],
    created_at: new Date().toISOString(),
    like_count: 0,
    comment_count: 0,
    is_sponsored: true,
    game_mode: template.mode,
    players_playing: players,
    cta_label: template.ctaLabel,
  };
}

/**
 * Periodic ad injection: returns a new array with ~1 sponsored post per every
 * 5-6 real posts. Guarantees ads appear at natural intervals during endless scrolling.
 */
export function injectSponsoredPosts(posts: FeedPost[], seed: number): FeedPost[] {
  if (posts.length < 3) return posts;

  const result: FeedPost[] = [];
  let adCount = 0;
  const adInterval = 5;

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    result.push(post);
    if ((i + 1) % adInterval === 0 && i + 1 < posts.length) {
      const adSeed = seed + adCount * 79 + (i + 1);
      result.push(buildSponsoredPost(adSeed));
      adCount++;
    }
  }

  return result;
}
