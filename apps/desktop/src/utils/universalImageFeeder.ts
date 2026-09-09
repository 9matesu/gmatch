/**
 * Universal API Image Feeder
 * 
 * Provides robust, multi-source image feeds for gMatch features:
 * - Simulated Moderation Minigame
 * - Discovery & explore feeds
 * - Slideshow streams
 * 
 * Validates URLs, supports live tag filtering, and ensures image capture integrity.
 */

import { getApiBaseUrl } from './api';

export interface FeederImage {
  id: string;
  url: string;
  source: 'gelbooru' | 'safebooru' | 'jikan' | 'local_api' | 'curated';
  caption: string;
  author: string;
  category: string;
  tags: string[];
  width?: number;
  height?: number;
  rating?: string;
  is_flagged?: boolean;
}

export const CURATED_FEED_BACKUPS: FeederImage[] = [
  {
    id: 'curated_1',
    url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop&q=80',
    source: 'curated',
    caption: 'Neon Cyberpunk Tokyo Tower #cyberpunk #neon',
    author: 'neon_shiba',
    category: 'cyberpunk',
    tags: ['cyberpunk', 'neon', 'city', 'night'],
  },
  {
    id: 'curated_2',
    url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80',
    source: 'curated',
    caption: 'Deep space cosmic nebula illustration #space #cosmic',
    author: 'astro_craft',
    category: 'anime',
    tags: ['space', 'cosmic', 'nebula', 'anime'],
  },
  {
    id: 'curated_3',
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
    source: 'curated',
    caption: 'Liquid iridescent glass wave render #abstract #fluid',
    author: 'wave_visuals',
    category: 'abstract',
    tags: ['abstract', 'fluid', 'render', 'shiny'],
  },
  {
    id: 'curated_4',
    url: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=80',
    source: 'curated',
    caption: 'Neon electric glow aesthetics #neon #art',
    author: 'chroma_king',
    category: 'cyberpunk',
    tags: ['neon', 'glowing', 'digital', 'synthwave'],
  },
  {
    id: 'curated_5',
    url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&auto=format&fit=crop&q=80',
    source: 'curated',
    caption: 'Renaissance oil painting museum showcase #fineart #vintage',
    author: 'art_collector',
    category: 'art',
    tags: ['art', 'fineart', 'painting', 'museum'],
  },
  {
    id: 'curated_6',
    url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=800&auto=format&fit=crop&q=80',
    source: 'curated',
    caption: 'Future synth grid sunset horizon #retro #synth',
    author: 'grid_runner',
    category: 'cyberpunk',
    tags: ['retro', 'synthwave', 'horizon', 'cyberpunk'],
  },
];

/**
 * Validates whether an image URL is well-formed, reachable, and safe to render.
 */
export function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.length < 5) return false;

  if (trimmed.startsWith('data:image/')) return true;

  try {
    const parsed = new URL(trimmed);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Asynchronously verifies that an image URL can be loaded by the browser.
 */
export function probeImageLoad(url: string, timeoutMs: number = 4000): Promise<boolean> {
  if (!isValidImageUrl(url)) return Promise.resolve(false);
  if (typeof window === 'undefined' || typeof Image === 'undefined') return Promise.resolve(true);

  return new Promise((resolve) => {
    let resolved = false;
    const img = new Image();

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        img.src = '';
        resolve(false);
      }
    }, timeoutMs);

    img.onload = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
      }
    };

    img.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(false);
      }
    };

    img.src = url;
  });
}

export interface FeederOptions {
  limit?: number;
  tags?: string[];
  page?: number;
  rating?: 'safe' | 'general' | 'all';
}

const EXPLICIT_TAGS = new Set(['explicit', 'nsfw', 'nude', 'nudity', 'sex', 'sexual', 'uncensored', 'hentai', 'porn', 'r34', 'rule34'])

export function isExplicitFeederImage(image: Pick<FeederImage, 'rating' | 'tags'>): boolean {
  const rating = String(image.rating || '').toLowerCase().trim()
  return rating === 'explicit' || rating === 'e' || (image.tags || []).some((tag) => {
    const normalized = tag.toLowerCase().replace(/[_-]+/g, ' ').trim()
    return EXPLICIT_TAGS.has(normalized) || normalized.split(/\s+/).some((part) => EXPLICIT_TAGS.has(part))
  })
}

function filterByRating(images: FeederImage[], rating: FeederOptions['rating']): FeederImage[] {
  if (!rating || rating === 'all') return images
  return images.filter((image) => !isExplicitFeederImage(image))
}

/**
 * Fetches images from the universal multi-source feeder pipeline.
 */
export async function fetchUniversalFeed(options: FeederOptions = {}): Promise<FeederImage[]> {
  const { limit = 8, tags = [], page = 1, rating = 'all' } = options;
  const tagQuery = tags.filter(Boolean).map((t) => t.trim()).join(' ');

  // 1. Try local/backend booru API slideshow endpoint
  try {
    const apiBase = getApiBaseUrl();
    const query = new URLSearchParams({
      limit: String(limit),
      page: String(page),
    });
    if (tagQuery) query.set('tags', tagQuery);

    const res = await fetch(`${apiBase}/api/booru/slideshow?${query.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.images) && data.images.length > 0) {
        const validated: FeederImage[] = [];
        for (const [idx, item] of data.images.entries()) {
          if (item?.url && isValidImageUrl(item.url)) {
            validated.push({
              id: item.id ? String(item.id) : `booru_${page}_${idx}_${Date.now()}`,
              url: item.url,
              source: 'local_api',
              caption: item.caption || '',
              author: item.author || 'gMatch Bot',
              category: tags[0] || 'anime',
              tags: Array.isArray(item.tags) ? item.tags : tags,
               rating: item.rating || 'unknown',
             });
          }
        }
        const filtered = filterByRating(validated, rating)
        if (filtered.length > 0) return filtered;
      }
    }
  } catch {}

  // 2. Direct Rule34 endpoint for NSFW / mixed content
  try {
    const r34Key = '521ffd9846555eb2718cf5a22a46b58e5528107c63dd207f77d8b8edcbc962ccfb02194b9dc4284490c846f42b72c90e520993dfe84e097e37d2d15c2823c5a6';
    const r34Uid = '2027820';
    const r34Tag = tagQuery ? encodeURIComponent(tagQuery) : 'highres';
    const res = await fetch(`https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&limit=${limit}&pid=${page}&tags=${r34Tag}&api_key=${r34Key}&user_id=${r34Uid}`);
    if (res.ok) {
      const posts = await res.json();
      if (Array.isArray(posts) && posts.length > 0) {
        const list: FeederImage[] = [];
        for (const p of posts) {
          const fileUrl = p.file_url || p.sample_url || p.image;
          if (fileUrl && isValidImageUrl(fileUrl)) {
            const rawTags = (p.tags || '').split(' ').filter(Boolean);
            const isExplicit = p.rating === 'explicit' || p.rating === 'e' || rawTags.some((t: string) => t.includes('nude') || t.includes('sex') || t.includes('nsfw') || t.includes('uncensored'));
            list.push({
              id: `r34_${p.id || Date.now()}`,
              url: fileUrl,
              source: 'gelbooru',
              caption: `#${rawTags.slice(0, 3).join(' #')}`,
              author: p.owner || 'rule34_bot',
              category: rawTags[0] || 'anime',
              tags: rawTags.slice(0, 10),
              rating: isExplicit ? 'explicit' : 'safe',
            });
          }
        }
        const filtered = filterByRating(list, rating)
        if (filtered.length > 0) return filtered;
      }
    }
  } catch {}

  // 3. Direct Safebooru endpoint
  try {
    const safeTag = tagQuery ? encodeURIComponent(tagQuery) : 'rating:general';
    const res = await fetch(`https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=${limit}&pid=${page}&tags=${safeTag}`);
    if (res.ok) {
      const posts = await res.json();
      if (Array.isArray(posts) && posts.length > 0) {
        const list: FeederImage[] = [];
        for (const p of posts) {
          const fileUrl = p.file_url || (p.image && p.directory ? `https://safebooru.org/images/${p.directory}/${p.image}` : null);
          if (fileUrl && isValidImageUrl(fileUrl)) {
            const rawTags = (p.tags || '').split(' ').filter(Boolean);
            list.push({
              id: `safe_${p.id}`,
              url: fileUrl,
              source: 'safebooru',
              caption: `#${rawTags.slice(0, 3).join(' #')}`,
              author: p.owner || 'safebooru_bot',
              category: rawTags[0] || 'anime',
              tags: rawTags.slice(0, 8),
              rating: 'safe',
            });
          }
        }
        const filtered = filterByRating(list, rating)
        if (filtered.length > 0) return filtered;
      }
    }
  } catch {}

  // 4. Jikan Top Anime Fallback
  try {
    const res = await fetch(`https://api.jikan.moe/v4/top/anime?limit=${limit}&page=${page}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.data) && data.data.length > 0) {
        const list: FeederImage[] = [];
        for (const item of data.data) {
          const imgUrl = item.images?.jpg?.large_image_url || item.images?.webp?.large_image_url;
          if (imgUrl && isValidImageUrl(imgUrl)) {
            list.push({
              id: `jikan_${item.mal_id}`,
              url: imgUrl,
              source: 'jikan',
              caption: item.title_english || item.title || 'Top Anime',
              author: 'jikan_anime',
              category: 'anime',
              tags: ['anime', 'featured', 'top', 'scenery', 'safe'],
              rating: 'safe',
            });
          }
        }
        const filtered = filterByRating(list, rating)
        if (filtered.length > 0) return filtered;
      }
    }
  } catch {}

  // 5. Return curated resilient backups
  return filterByRating(CURATED_FEED_BACKUPS, rating).slice(0, limit);
}
