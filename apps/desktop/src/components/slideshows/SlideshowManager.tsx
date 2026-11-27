"use client";

import { useState, useEffect, useCallback } from 'react';
import { orbitFetch } from '../../utils/api';
import { playPress } from '../../utils/sounds';
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject } from '@orbit/shared';
import type { FeedPost } from '../feed/GMatchFeed';
import { SlideshowPlayer, type ResolvedItem } from './SlideshowPlayer';
import { logger } from '../../utils/logger'
import { Button, Input, Select } from '../../ui/kit'
import { classes, CHROME, COLOR, FEEDBACK, GAP, ICON, PADDING, RADIUS, STATUS, TRACKING, TYPE, WEIGHT } from '../../ui/tokens'
import {
  Play,
  Trash2,
  Plus,
  X,
  Film,
  Image as ImageIcon,
} from 'lucide-react';

interface SlideshowSummary {
  id: string;
  title: string | null;
  source: 'cards' | 'posts' | 'both';
  interval_ms: number;
  item_count: number;
  created_at: string;
}

type Source = 'cards' | 'posts' | 'both';

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
    if (selected.size === 0) {
      toast?.('Select at least one item', 'warning');
      return;
    }
    body.items = Array.from(selected).map((object_id) => ({ object_id }));
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
    } catch (err) {
      logger.warn('[SlideshowManager] DELETE /api/slideshows/:id failed', err)
    }
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
  };

  return (
    <div className={classes(COLOR.surfaceRaised, 'border', COLOR.edge, RADIUS.panel, PADDING[4], 'space-y-4')}>
      <div className="flex items-center justify-between">
        <div className={classes('flex items-center', GAP[2])}>
          <Film className={classes(ICON.md, COLOR.muted)} />
          <h2 className={CHROME.sectionLabel}>Slideshows</h2>
        </div>
        <div className={classes('flex items-center', GAP[2])}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => { setCreating((v) => !v); setSelected(new Set()); }}
            className={classes('flex items-center', GAP[1.5])}
          >
            {creating ? <X className={ICON.sm} /> : <Plus className={ICON.sm} />}
            {creating ? 'Cancel' : 'New'}
          </Button>
          {onClose && (
            <Button type="button" variant="ghost" onClick={onClose} aria-label="Close slideshow manager" className={PADDING[1.5]}>
              <X className={ICON.md} />
            </Button>
          )}
        </div>
      </div>

      {creating && (
        <div className={classes('space-y-3 border-t', COLOR.edge, 'pt-3')}>
          <Input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Slideshow title (optional)"
          />

          <div className={classes('flex flex-wrap items-center', GAP[1])}>
            {(Object.keys(sourceLabel) as Source[]).map((s) => (
              <Button
                key={s}
                type="button"
                variant={source === s ? 'secondary' : 'ghost'}
                onClick={() => { setSource(s); setSelected(new Set()); }}
              >
                {sourceLabel[s]}
              </Button>
            ))}
          </div>

          <div>
            <p className={classes(FEEDBACK.description, 'mb-2')}>
              {selected.size} selected · {candidates.length} available
            </p>
            <div className={classes('grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4', GAP[2], 'max-h-56 overflow-y-auto styled-scrollbar')}>
              {candidates.map((c) => {
                const isSelected = selected.has(c.id);
                return (
                  <Button
                    key={c.id}
                    type="button"
                    variant={isSelected ? 'secondary' : 'ghost'}
                    onClick={() => toggleSelect(c.id)}
                    className={classes('flex items-center text-left', GAP[2], PADDING[2], isSelected ? 'border-retro-accent' : 'border-edge')}
                  >
                    {c.kind === 'post' ? <ImageIcon className={classes(ICON.sm, 'shrink-0')} /> : <Film className={classes(ICON.sm, 'shrink-0')} />}
                    <span className={classes(TYPE.body, 'truncate')}>{c.label}</span>
                  </Button>
                );
              })}
              {candidates.length === 0 && (
                <p className={classes('col-span-full', FEEDBACK.description)}>No {sourceLabel[source]} available to select.</p>
              )}
            </div>
          </div>

          <div className={classes('flex items-center', GAP[3])}>
            <label className={classes(TYPE.body, COLOR.muted, 'flex items-center', GAP[2])}>
              Interval
              <Select
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
              >
                <option value={2000}>2s</option>
                <option value={5000}>5s</option>
                <option value={8000}>8s</option>
                <option value={15000}>15s</option>
              </Select>
            </label>
            <Button
              type="button"
              variant="primary"
              onClick={create}
              disabled={saving}
              className={classes('ml-auto', WEIGHT.bold, 'uppercase', TRACKING.wider)}
            >
              {saving ? 'Saving…' : 'Create Slideshow'}
            </Button>
          </div>
        </div>
      )}

      <div className={classes('space-y-2 border-t', COLOR.edge, 'pt-3')}>
        {loading ? (
          <p className={FEEDBACK.description}>Loading…</p>
        ) : list.length === 0 ? (
          <p className={FEEDBACK.description}>No slideshows yet. Create one from your gallery cards or posts.</p>
        ) : (
          list.map((s) => (
            <div key={s.id} className={classes(CHROME.rowTile, 'flex items-center justify-between', GAP[2])}>
              <div className="min-w-0">
                <p className={classes(TYPE.body, WEIGHT.semibold, COLOR.fg, 'truncate')}>{s.title || 'Untitled slideshow'}</p>
                <p className={FEEDBACK.description}>
                  {sourceLabel[s.source]} · {s.item_count} item{s.item_count === 1 ? '' : 's'}
                </p>
              </div>
              <div className={classes('flex items-center', GAP[1], 'shrink-0')}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => play(s)}
                  aria-label="Play slideshow"
                  className={PADDING[1.5]}
                >
                  <Play className={ICON.md} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(s.id)}
                  aria-label="Delete slideshow"
                  className={classes(PADDING[1.5], STATUS.danger)}
                >
                  <Trash2 className={ICON.md} />
                </Button>
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
