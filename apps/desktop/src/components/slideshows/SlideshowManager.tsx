"use client";

import { useState, useEffect, useCallback } from 'react';
import { orbitFetch } from '../../utils/api';
import { playPress } from '../../utils/sounds';
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject } from '@orbit/shared';
import type { FeedPost } from '../feed/GMatchFeed';
import { SlideshowPlayer, type ResolvedItem } from './SlideshowPlayer';
import {
  Play,
  Trash2,
  Plus,
  X,
  Film,
  Image as ImageIcon,
  Tag,
} from 'lucide-react';

interface SlideshowSummary {
  id: string;
  title: string | null;
  source: 'cards' | 'posts' | 'both' | 'api';
  tags: string[];
  interval_ms: number;
  item_count: number;
  created_at: string;
}

type Source = 'cards' | 'posts' | 'both' | 'api';

interface Candidate {
  id: string;
  kind: 'card' | 'post';
  label: string;
}

export function SlideshowManager({
  identity,
  cards,
  posts,
  toast,
  onClose,
}: {
  identity: OrbitIdentity | null;
  cards: OrbitObject[];
  posts: FeedPost[];
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onClose?: () => void;
}) {
  const [list, setList] = useState<SlideshowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState<Source>('cards');
  const [tags, setTags] = useState('');
  const [intervalMs, setIntervalMs] = useState(5000);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<{ items: ResolvedItem[]; intervalMs: number } | null>(null);

  const load = useCallback(() => {
    if (!identity) return;
    setLoading(true);
    orbitFetch('/api/slideshows', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setList(Array.isArray(data?.slideshows) ? data.slideshows : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [identity]);

  useEffect(() => {
    load();
  }, [load]);

  const candidates: Candidate[] = (() => {
    const out: Candidate[] = [];
    if (source === 'cards' || source === 'both') {
      for (const c of cards) {
        out.push({ id: c.id, kind: 'card', label: c.caption || c.id });
      }
    }
    if (source === 'posts' || source === 'both') {
      for (const p of posts) {
        if (!p || !p.id) continue;
        out.push({ id: p.id, kind: 'post', label: p.caption || 'Post' });
      }
    }
    return out;
  })();

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async () => {
    if (!identity || saving) return;
    const body: any = {
      title: title.trim() || null,
      source,
      interval_ms: intervalMs,
    };
    if (source === 'api') {
      body.tags = tags.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean);
    } else {
      if (selected.size === 0) {
        toast?.('Select at least one item', 'warning');
        return;
      }
      body.items = Array.from(selected).map((object_id) => ({ object_id }));
    }
    setSaving(true);
    try {
      const res = await orbitFetch('/api/slideshows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, identity);
      if (res.ok) {
        playPress(880);
        toast?.('Slideshow created', 'success');
        setTitle('');
        setTags('');
        setSelected(new Set());
        setCreating(false);
        load();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to create slideshow' }));
        toast?.(err.error || 'Failed to create slideshow', 'error');
      }
    } catch {
      toast?.('Network error creating slideshow', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!identity) return;
    try {
      const res = await orbitFetch(`/api/slideshows/${id}`, { method: 'DELETE' }, identity);
      if (res.ok) {
        playPress(640);
        toast?.('Slideshow deleted', 'info');
        load();
      }
    } catch { }
  };

  const play = async (s: SlideshowSummary) => {
    if (!identity) return;
    try {
      const res = await orbitFetch(`/api/slideshows/${s.id}/items`, {}, identity);
      if (!res.ok) { toast?.('Failed to load slideshow', 'error'); return; }
      const data = await res.json();
      const items: ResolvedItem[] = Array.isArray(data?.items) ? data.items : [];
      if (items.length === 0) { toast?.('This slideshow has no items', 'warning'); return; }
      playPress(900);
      setPlaying({ items, intervalMs: s.interval_ms });
    } catch {
      toast?.('Network error loading slideshow', 'error');
    }
  };

  const sourceLabel: Record<Source, string> = {
    cards: 'Cards',
    posts: 'Posts',
    both: 'Cards + Posts',
    api: 'API Tags',
  };

  return (
    <div className="bg-surface-raised border border-border-glass rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-retro-muted" />
          <h2 className="text-xs font-bold text-retro-fg uppercase tracking-wider">Slideshows</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setCreating((v) => !v); setSelected(new Set()); }}
            className="px-3 py-1.5 text-xs font-semibold text-retro-body bg-surface-interactive border border-border-glass rounded-lg hover:border-zinc-500 cursor-pointer flex items-center gap-1.5 transition-colors"
          >
            {creating ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {creating ? 'Cancel' : 'New'}
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-retro-muted hover:text-retro-fg hover:bg-surface-interactive cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {creating && (
        <div className="space-y-3 border-t border-border-glass pt-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Slideshow title (optional)"
            className="w-full bg-retro-bg border border-border-glass px-3 py-2 text-xs text-retro-fg placeholder:text-retro-muted rounded-lg outline-none focus:border-retro-accent"
          />

          <div className="flex flex-wrap items-center gap-1">
            {(Object.keys(sourceLabel) as Source[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setSource(s); setSelected(new Set()); }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer border ${
                  source === s ? 'bg-surface-interactive text-retro-fg border-border-glass' : 'text-retro-muted hover:text-retro-body border-transparent'
                }`}
              >
                {sourceLabel[s]}
              </button>
            ))}
          </div>

          {source === 'api' ? (
            <div className="flex items-center gap-2 bg-surface-interactive border border-border-glass rounded-lg px-3 py-2">
              <Tag className="w-3.5 h-3.5 text-retro-muted" />
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Comma-separated tags (e.g. scenery, cyberpunk)"
                className="flex-1 bg-transparent text-xs text-retro-fg placeholder:text-retro-muted outline-none"
              />
            </div>
          ) : (
            <div>
              <p className="text-xs text-retro-muted mb-2">
                {selected.size} selected · {candidates.length} available
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-56 overflow-y-auto styled-scrollbar">
                {candidates.map((c) => {
                  const isSelected = selected.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleSelect(c.id)}
                      className={`flex items-center gap-2 px-2 py-2 rounded-lg border text-left cursor-pointer transition-colors ${
                        isSelected ? 'bg-surface-interactive border-retro-accent text-retro-fg' : 'bg-surface-interactive/40 border-border-glass text-retro-muted hover:text-retro-body'
                      }`}
                    >
                      {c.kind === 'post' ? <ImageIcon className="w-3.5 h-3.5 shrink-0" /> : <Film className="w-3.5 h-3.5 shrink-0" />}
                      <span className="text-xs truncate">{c.label}</span>
                    </button>
                  );
                })}
                {candidates.length === 0 && (
                  <p className="col-span-full text-xs text-retro-muted">No {sourceLabel[source]} available to select.</p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <label className="text-xs text-retro-muted flex items-center gap-2">
              Interval
              <select
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
                className="bg-surface-interactive border border-border-glass text-retro-body text-xs rounded-lg px-2 py-1 outline-none cursor-pointer"
              >
                <option value={2000}>2s</option>
                <option value={5000}>5s</option>
                <option value={8000}>8s</option>
                <option value={15000}>15s</option>
              </select>
            </label>
            <button
              type="button"
              onClick={create}
              disabled={saving}
              className="ml-auto px-4 py-1.5 bg-retro-accent text-black font-bold text-xs uppercase tracking-wider rounded-lg cursor-pointer disabled:opacity-40 hover:bg-retro-accent-hover transition-colors"
            >
              {saving ? 'Saving…' : 'Create Slideshow'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-border-glass pt-3">
        {loading ? (
          <p className="text-xs text-retro-muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-xs text-retro-muted">No slideshows yet. Create one from your gallery cards, posts, or API tags.</p>
        ) : (
          list.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 bg-surface-interactive/40 border border-border-glass rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-retro-fg truncate">{s.title || 'Untitled slideshow'}</p>
                <p className="text-xs text-retro-muted">
                  {sourceLabel[s.source]} · {s.source === 'api' ? (s.tags.join(', ') || 'default tags') : `${s.item_count} item${s.item_count === 1 ? '' : 's'}`}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => play(s)}
                  aria-label="Play slideshow"
                  className="p-1.5 rounded-lg text-retro-body hover:text-retro-fg hover:bg-surface-interactive cursor-pointer"
                >
                  <Play className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  aria-label="Delete slideshow"
                  className="p-1.5 rounded-lg text-retro-muted hover:text-rose-400 hover:bg-surface-interactive cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {playing && (
        <SlideshowPlayer
          items={playing.items}
          intervalMs={playing.intervalMs}
          identity={identity}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}
