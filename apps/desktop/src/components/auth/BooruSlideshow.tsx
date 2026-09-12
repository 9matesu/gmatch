"use client";

import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Sparkles, Image as ImageIcon } from 'lucide-react';
import { playPress } from '../../utils/sounds';
import { getApiBaseUrl } from '../../utils/api';
import { resolveMediaUrl } from '../../utils/media';

interface SlideshowImage {
  url: string;
  caption?: string;
}

const SLIDE_INTERVAL_MS = 4500;

const CURATED_FALLBACK_IMAGES: SlideshowImage[] = [
  {
    url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop&q=80',
    caption: 'Anime Aesthetics',
  },
  {
    url: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=80',
    caption: 'Neon Cyberpunk',
  },
  {
    url: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800&auto=format&fit=crop&q=80',
    caption: 'Retro Wave Art',
  },
  {
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
    caption: 'Digital Collector',
  },
];

async function fetchSlideshowImages(): Promise<SlideshowImage[]> {
  // 1. Admin-configured booru pool (honors bot_tags from admin panel)
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/api/booru/slideshow?limit=8`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.images) && data.images.length > 0) {
        const valid = data.images.filter((i: any) => i && i.url);
        if (valid.length > 0) return valid;
      }
    }
  } catch {}

  // 2. AniList (fallback)
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: `
          query {
            Page(perPage: 8) {
              media(type: ANIME, sort: TRENDING_DESC) {
                id
                title {
                  english
                  romaji
                }
                coverImage {
                  extraLarge
                  large
                }
              }
            }
          }
        `,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const list = data?.data?.Page?.media;
      if (Array.isArray(list) && list.length > 0) {
        const valid = list
          .filter((m: any) => m && (m.coverImage?.extraLarge || m.coverImage?.large))
          .map((m: any) => ({
            url: m.coverImage?.extraLarge || m.coverImage?.large,
            caption: m.title?.english || m.title?.romaji || 'Featured Anime',
          }));
        if (valid.length > 0) return valid;
      }
    }
  } catch {}

  // 3. Jikan (fallback)
  try {
    const res = await fetch('https://api.jikan.moe/v4/top/anime?limit=8');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.data) && data.data.length > 0) {
        const valid = data.data
          .filter((a: any) => a && (a.images?.jpg?.large_image_url || a.images?.webp?.large_image_url))
          .map((a: any) => ({
            url: a.images?.jpg?.large_image_url || a.images?.webp?.large_image_url,
            caption: a.title_english || a.title || 'Top Anime',
          }));
        if (valid.length > 0) return valid;
      }
    }
  } catch {}

  return CURATED_FALLBACK_IMAGES;
}

export function BooruSlideshow({ className = '' }: { className?: string }) {
  const [images, setImages] = useState<SlideshowImage[]>(CURATED_FALLBACK_IMAGES);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSlideshowImages()
      .then((list) => {
        if (cancelled) return;
        if (list.length > 0) {
          setImages(list);
          setActiveIndex(0);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const goTo = useCallback((idx: number) => {
    playPress(700);
    setActiveIndex((_prev) => (images.length === 0 ? 0 : (idx + images.length) % images.length));
  }, [images.length]);

  useEffect(() => {
    if (images.length < 2) return;
    const id = setInterval(() => {
      if (document.hidden) return
      setActiveIndex((prev) => (prev + 1) % images.length);
    }, SLIDE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [images.length]);

  const current = images[activeIndex] || images[0];

  return (
    <div className={`relative mx-auto flex flex-col items-center shrink-0 ${className}`}>
      {/* Outer Smartphone Bezel */}
      <div className="relative w-[clamp(220px,40vw,340px)] aspect-[9/16] rounded-[2.5rem] p-2.5 bg-gradient-to-b from-zinc-800 via-zinc-900 to-zinc-950 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-border-glass shrink-0">
        <div className="absolute inset-[1px] rounded-[2.4rem] bg-gradient-to-b from-zinc-700/20 via-transparent to-transparent pointer-events-none" />

        {/* Inner Phone Screen */}
        <div className="relative w-full h-full rounded-[2rem] overflow-hidden bg-surface-canvas select-none shadow-inner group">

          {/* Top Notch / Dynamic Island */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 w-20 h-3.5 bg-black rounded-full flex items-center justify-end px-2 gap-1.5 shadow-md">
            <span className="w-1.5 h-1.5 rounded-full bg-surface-elevated" />
            <span className="w-1.5 h-1.5 rounded-full bg-surface-canvas border border-border-glass" />
          </div>

          {/* Bottom Home Indicator Bar */}
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-30 w-24 h-1 bg-glass-w20 rounded-full backdrop-blur-sm pointer-events-none" />

          {/* Stack of Slides */}
          {images.map((img, idx) => (
            <img
              key={img.url + idx}
              src={resolveMediaUrl(img.url)}
              alt={img.caption || 'gMatch feed'}
              loading={idx === 0 ? 'eager' : 'lazy'}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                idx === activeIndex ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            />
          ))}

          {/* Aesthetic Overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 pointer-events-none" />

          {/* Top Navigation & Status Bar */}
          <div className="absolute top-7 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-[10px] font-bold text-white">
              <span className="w-1.5 h-1.5 rounded-full bg-retro-accent animate-pulse shadow-[0_0_6px_rgba(159,227,255,0.5)]" />
              <span>Live Feed</span>
            </div>
            <div className="px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-[10px] font-mono font-bold text-white/90">
              <ImageIcon className="w-2.5 h-2.5 inline mr-1 -mt-0.5" />
              {activeIndex + 1}/{images.length}
            </div>
          </div>

          {/* Caption Overlay */}
          <div className="absolute bottom-6 left-3 right-3 z-20">
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/30 backdrop-blur-md text-[10px] font-black uppercase tracking-wider text-white mb-1.5">
              <Sparkles className="w-2.5 h-2.5 text-retro-accent" />
              <span>Trending</span>
            </div>
            {current?.caption && (
              <p className="text-xs font-bold text-white drop-shadow-md line-clamp-2 leading-tight">
                {current.caption}
              </p>
            )}
          </div>

          {/* Prev / Next Interactive Arrow Buttons */}
          <button
            type="button"
            onClick={() => goTo(activeIndex - 1)}
            aria-label="Previous image"
            className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 hover:bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-20 backdrop-blur-sm active:scale-95"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => goTo(activeIndex + 1)}
            aria-label="Next image"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 hover:bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-20 backdrop-blur-sm active:scale-95"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* Progress Dots Bar */}
          <div className="absolute top-14 left-3 right-3 z-20 flex items-center gap-1">
            {images.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => goTo(idx)}
                aria-label={`Slide ${idx + 1}`}
                className={`h-0.5 flex-1 rounded-full transition-all cursor-pointer ${
                  idx === activeIndex ? 'bg-retro-accent' : 'bg-white/30 hover:bg-white/50'
                }`}
              />
            ))}
          </div>

          {loading && images.length <= CURATED_FALLBACK_IMAGES.length && (
            <div className="absolute inset-0 flex items-center justify-center z-30">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
