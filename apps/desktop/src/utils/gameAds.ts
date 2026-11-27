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

export const GAME_AD_TEMPLATES: GameAdTemplate[] = [
  {
    mode: 'discord',
    gameName: 'Official Discord',
    tagline: 'Community server. Updates land there first.',
    ctaLabel: 'Join Our Discord',
    gradient: 'from-[#5865F2] via-[#7289da] to-[#4752C4]',
    icon: 'discord',
    badge: 'COMMUNITY',
  },
  {
    mode: 'coffee',
    gameName: 'Buy Me A Coffee',
    tagline: 'Support development. Supporters get badges and a few perks.',
    ctaLabel: 'Buy a Coffee',
    gradient: 'from-amber-400 via-yellow-500 to-amber-600',
    icon: 'coffee',
    badge: 'SUPPORT US',
  },
  {
    mode: 'duel',
    gameName: 'Card Duel Arena',
    tagline: '1v1 card duels with real stakes.',
    ctaLabel: 'Enter the Arena',
    gradient: 'from-[#f09433] via-[#dc2743] to-[#bc1888]',
    icon: 'duel',
    badge: '1v1 DUELS LIVE',
  },
  {
    mode: 'babecock',
    gameName: 'Babecock',
    tagline: 'Fast rounds. Streaks count.',
    ctaLabel: 'Start a Session',
    gradient: 'from-amber-400 via-orange-500 to-rose-600',
    icon: 'babecock',
    badge: 'LIVE NOW',
  },
  {
    mode: 'ranks',
    gameName: 'Rankings',
    tagline: 'The global leaderboard. Only the obsessed stay on top.',
    ctaLabel: 'See the Standings',
    gradient: 'from-yellow-400 via-amber-500 to-orange-600',
    icon: 'ranks',
    badge: 'SEASON 7',
  },
  {
    mode: 'store',
    gameName: 'Arcade Store',
    tagline: 'Cards, powerups and loot. New stock drops now and then.',
    ctaLabel: 'Open the Store',
    gradient: 'from-violet-500 via-purple-600 to-fuchsia-700',
    icon: 'store',
    badge: 'NEW DROP',
  },
];


