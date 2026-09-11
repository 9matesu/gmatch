"use client";

import { useCallback, useEffect, useState } from 'react';
import { orbitFetch } from '../../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import { useToast } from '../Toast';
import { Plus, Trash2, CheckCircle2, Circle, Pencil, Archive, Tag } from 'lucide-react';

interface LootboxRow {
  id: string;
  name: string;
  desc: string | null;
  cost: number;
  card_count: number;
  rarity_theme: string;
  icon: string;
  badge: string | null;
  released: number;
  state: 'draft' | 'released' | 'archived';
  tags: string[];
  draw_config: Record<string, unknown>;
  version: number;
  released_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

const ICONS = ['Sparkles', 'Box', 'Gift', 'Gem', 'Star', 'Trophy', 'Zap', 'Crown'];

const STATE_LABEL: Record<LootboxRow['state'], { text: string; cls: string }> = {
  draft: { text: 'Draft', cls: 'bg-[#27272a] text-zinc-400' },
  released: { text: 'Released', cls: 'bg-emerald-500/15 text-emerald-400' },
  archived: { text: 'Archived', cls: 'bg-amber-500/15 text-amber-400' },
};

function parseTagsInput(input: string): string[] {
  return Array.from(new Set(
    input
      .split(/[\n,]+/)
      .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean)
  ));
}

export function LootboxAdminPanel({ identity }: { identity: OrbitIdentity | null }) {
  const { toast } = useToast();
  const [lootboxes, setLootboxes] = useState<LootboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editor state — reused for create and edit.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [cost, setCost] = useState(250);
  const [cardCount, setCardCount] = useState(3);
  const [rarityTheme, setRarityTheme] = useState('rare');
  const [icon, setIcon] = useState('Sparkles');
  const [badge, setBadge] = useState('');
  const [tagsText, setTagsText] = useState('');

  const resetEditor = useCallback(() => {
    setEditingId(null);
    setName('');
    setDesc('');
    setCost(250);
    setCardCount(3);
    setRarityTheme('rare');
    setIcon('Sparkles');
    setBadge('');
    setTagsText('');
  }, []);

  const load = useCallback(() => {
    if (!identity) return;
    setLoading(true);
    orbitFetch('/api/admin/settings/lootboxes', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setLootboxes(Array.isArray(data?.lootboxes) ? data.lootboxes : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [identity]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (lb: LootboxRow) => {
    setEditingId(lb.id);
    setName(lb.name);
    setDesc(lb.desc || '');
    setCost(Number(lb.cost || 0));
    setCardCount(Number(lb.card_count || 3));
    setRarityTheme(lb.rarity_theme || 'rare');
    setIcon(lb.icon || 'Sparkles');
    setBadge(lb.badge || '');
    setTagsText((lb.tags || []).join(', '));
  };

  const submit = async () => {
    if (!identity || saving || !name.trim()) return;
    setSaving(true);
    const payload = {
      name: name.trim(),
      desc: desc.trim() || null,
      cost: Math.max(0, Math.floor(cost)),
      card_count: Math.min(Math.max(1, Math.floor(cardCount)), 20),
      rarity_theme: rarityTheme,
      icon,
      badge: badge.trim() || null,
      tags: parseTagsInput(tagsText),
    };
    try {
      const res = editingId
        ? await orbitFetch(`/api/admin/settings/lootboxes/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }, identity)
        : await orbitFetch('/api/admin/settings/lootboxes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, released: false }),
          }, identity);
      if (res.ok) {
        toast(editingId ? 'Lootbox updated' : 'Lootbox created (draft)', 'success');
        resetEditor();
        load();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to save' }));
        toast(err.error || 'Failed to save lootbox', 'error');
      }
    } catch {
      toast('Network error', 'error');
    } finally {
      setSaving(false);
    }
  };

  const transition = async (lb: LootboxRow, state: 'draft' | 'released' | 'archived') => {
    if (!identity) return;
    try {
      if (state === 'archived') {
        await orbitFetch(`/api/admin/settings/lootboxes/${lb.id}`, { method: 'DELETE' }, identity);
        toast(`Archived ${lb.name}`, 'info');
      } else {
        await orbitFetch(`/api/admin/settings/lootboxes/${lb.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state }),
        }, identity);
        toast(state === 'released' ? `Released ${lb.name}` : `Unreleased ${lb.name}`, 'success');
      }
      load();
    } catch { }
  };

  return (
    <div className="bg-[#18181b] border border-[#27272a] p-5 rounded-xl shadow-xs space-y-4">
      <div className="text-xs font-bold text-zinc-100 uppercase tracking-wider flex items-center gap-2">
        <span>Lootboxes</span>
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed">
        Draft boxes are invisible to players. Release a box to list it in the store. Archiving keeps purchased inventory openable.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="px-3 py-2 bg-[#27272a] border border-[#27272a] rounded-xl text-xs text-zinc-100 outline-none focus:border-cyan-500" />
        <input type="text" value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="Badge (e.g. HOLO)" className="px-3 py-2 bg-[#27272a] border border-[#27272a] rounded-xl text-xs text-zinc-100 outline-none focus:border-cyan-500" />
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" className="px-3 py-2 bg-[#27272a] border border-[#27272a] rounded-xl text-xs text-zinc-100 outline-none focus:border-cyan-500 col-span-1 sm:col-span-2" />
        <input
          type="text"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="Tags (comma separated, e.g. anime, cyber)"
          className="px-3 py-2 bg-[#27272a] border border-[#27272a] rounded-xl text-xs text-zinc-100 outline-none focus:border-cyan-500 col-span-1 sm:col-span-2"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500 whitespace-nowrap">Cost (g$)</label>
          <input type="number" value={cost} onChange={(e) => setCost(Number(e.target.value))} className="flex-1 px-3 py-2 bg-[#27272a] border border-[#27272a] rounded-xl text-xs text-zinc-100 outline-none focus:border-cyan-500" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500 whitespace-nowrap">Cards</label>
          <input type="number" value={cardCount} onChange={(e) => setCardCount(Number(e.target.value))} className="flex-1 px-3 py-2 bg-[#27272a] border border-[#27272a] rounded-xl text-xs text-zinc-100 outline-none focus:border-cyan-500" />
        </div>
        <select value={rarityTheme} onChange={(e) => setRarityTheme(e.target.value)} className="px-3 py-2 bg-[#27272a] border border-[#27272a] rounded-xl text-xs text-zinc-100 outline-none focus:border-cyan-500">
          <option value="common">Common</option>
          <option value="rare">Rare</option>
          <option value="legendary">Legendary</option>
          <option value="mythic">Mythic</option>
        </select>
        <select value={icon} onChange={(e) => setIcon(e.target.value)} className="px-3 py-2 bg-[#27272a] border border-[#27272a] rounded-xl text-xs text-zinc-100 outline-none focus:border-cyan-500">
          {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving || !name.trim()}
          className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> {editingId ? 'Save Changes' : 'Create Lootbox'}
        </button>
        {editingId ? (
          <button type="button" onClick={resetEditor} className="px-3 py-2 bg-[#27272a] text-zinc-400 hover:text-zinc-200 rounded-xl text-xs font-bold cursor-pointer">
            Cancel
          </button>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-[#27272a] pt-3">
        {loading ? (
          <p className="text-xs text-zinc-500">Loading…</p>
        ) : lootboxes.length === 0 ? (
          <p className="text-xs text-zinc-500">No lootboxes yet.</p>
        ) : (
          lootboxes.map((lb) => {
            const stateLabel = STATE_LABEL[lb.state] || STATE_LABEL.draft;
            return (
              <div key={lb.id} className="flex items-center justify-between gap-3 bg-[#27272a]/60 border border-[#27272a] rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-zinc-100 truncate">{lb.name}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${stateLabel.cls}`}>{stateLabel.text}</span>
                    {lb.badge ? <span className="text-[10px] text-cyan-400">[{lb.badge}]</span> : null}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {lb.cost} g$ · {lb.card_count} cards · {lb.rarity_theme} · v{lb.version}
                  </p>
                  {lb.tags.length > 0 ? (
                    <p className="text-xs text-zinc-500 flex items-center gap-1 flex-wrap">
                      <Tag className="w-3 h-3" />
                      {lb.tags.slice(0, 6).join(' · ')}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {lb.state !== 'archived' ? (
                    <button
                      type="button"
                      onClick={() => startEdit(lb)}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-cyan-400 cursor-pointer"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                  {lb.state === 'draft' ? (
                    <button type="button" onClick={() => transition(lb, 'released')} className="px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer bg-[#27272a] text-zinc-400 hover:text-emerald-400">
                      <Circle className="w-3.5 h-3.5" /> Release
                    </button>
                  ) : lb.state === 'released' ? (
                    <>
                      <button type="button" onClick={() => transition(lb, 'draft')} className="px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer bg-emerald-500/15 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Released
                      </button>
                      <button type="button" onClick={() => transition(lb, 'archived')} className="p-1.5 rounded-lg text-zinc-500 hover:text-amber-400 cursor-pointer" title="Archive">
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-400 cursor-not-allowed">
                      <Archive className="w-3.5 h-3.5" /> Archived
                    </button>
                  )}
                  {lb.state === 'draft' ? (
                    <button type="button" onClick={() => transition(lb, 'archived')} className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 cursor-pointer" title="Archive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
