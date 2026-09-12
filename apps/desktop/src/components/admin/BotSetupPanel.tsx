"use client";

import { useState, useEffect } from 'react';
import { orbitFetch } from '../../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import { useToast } from '../Toast';
import { logger } from '../../utils/logger';
import {
  Bot,
  Globe,
  Tag,
  Users,
  Play,
  Save,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Terminal,
  Eye,
  EyeOff,
  Sparkles,
  Plus,
  Trash2,
  Check,
  Sliders,
  Image as ImageIcon,
} from 'lucide-react';
import { DEFAULT_BOORU_PROVIDERS, DEFAULT_BOT_NAMES } from '@orbit/shared';
import type { ProviderType, BotApiProvider, BotConfig, ApiTestResult, BotActivationRule, BotProfileRecord } from '@orbit/shared';
import { BooruQueryBox } from './BooruQueryBox';

const PRESET_PROVIDERS: Omit<BotApiProvider, 'id'>[] = [
  ...DEFAULT_BOORU_PROVIDERS.map(({ id: _id, ...rest }) => rest),
  {
    name: 'Custom JSON Endpoint',
    providerType: 'generic',
    url: 'https://api.example.com/images?tags={tags}&limit={limit}',
    apiKey: '',
    userId: '',
    tags: ['cyber', 'neon', 'fantasy'],
    enabled: false,
    weight: 5,
  },
];

const PRESET_NAMES = {
  cyberpunk: DEFAULT_BOT_NAMES,
  anime: ['Sakura', 'Akira', 'Yuki', 'Ren', 'Hinata', 'Kaito', 'Asuka', 'Shinji', 'Misaki', 'Haruto', 'Aoi', 'Kazuto', 'Mikoto', 'Rin', 'Sora'],
  mythic: ['Athena', 'Apollo', 'Artemis', 'Ares', 'Hermes', 'Freya', 'Odin', 'Thor', 'Loki', 'Valkyrie', 'Zeus', 'Hades', 'Anubis', 'Osiris', 'Ra'],
};

function makeProviderId(): string {
  return `prov_${Date.now()}`;
}

export function BotSetupPanel({ identity }: { identity: OrbitIdentity }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Bot Config State
  const [providers, setProviders] = useState<BotApiProvider[]>([]);
  const [globalTags, setGlobalTags] = useState<string[]>(['1girl', 'scenery', 'highres', 'game_cg']);
  const [namesText, setNamesText] = useState(PRESET_NAMES.cyberpunk.join('\n'));
  const [enabled, setEnabled] = useState(true);
  const [activationRule, setActivationRule] = useState<BotActivationRule>('fallback');
  const [fallbackSeconds, setFallbackSeconds] = useState(120);
  const [modelsText, setModelsText] = useState('');
  const [starterTagsText, setStarterTagsText] = useState('');

  // Persistent per-bot duelist profiles
  const [bots, setBots] = useState<BotProfileRecord[]>([]);
  const [botsBusyId, setBotsBusyId] = useState<string | null>(null);
  const [customUrlFor, setCustomUrlFor] = useState<Record<string, string>>({});
  const [newBotName, setNewBotName] = useState('');
  const [newBotTags, setNewBotTags] = useState('');

  // Active Provider Being Edited or Tested
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [selectedTestProviderId, setSelectedTestProviderId] = useState<string | null>(null);
  const [showKeyFor, setShowKeyFor] = useState<Record<string, boolean>>({});

  // Provider selection for batch operations
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(new Set());

  // Diagnostics Test Results
  const [testResult, setTestResult] = useState<ApiTestResult | null>(null);

  // Bot roster dirty tracking for Save Roster
  const [dirtyBotIds, setDirtyBotIds] = useState<Set<string>>(new Set());

  // Load configuration from API on mount
  useEffect(() => {
    let cancelled = false;
    orbitFetch('/api/admin/bot-config', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BotConfig | null) => {
        if (cancelled || !data) return;
        if (Array.isArray(data.providers)) {
          // An empty array can be a deliberate persisted configuration.
          setProviders(data.providers);
          setSelectedTestProviderId(data.providers[0]?.id || null);
        } else {
          // Only use presets when the backend did not provide a providers field.
          const initial = PRESET_PROVIDERS.map((p, idx) => ({
            ...p,
            id: `prov_${idx + 1}`,
          }));
          setProviders(initial);
          setSelectedTestProviderId(initial[0].id);
        }
        if (Array.isArray(data.tags)) {
          // An empty array can be a deliberate persisted configuration.
          setGlobalTags(data.tags);
        } else if (typeof (data as any).tags === 'string') {
          setGlobalTags((data as any).tags.split(/[\n,]+/).map((t: string) => t.trim()).filter(Boolean));
        }
        setNamesText(Array.isArray(data.names) ? data.names.join('\n') : PRESET_NAMES.cyberpunk.join('\n'));
        setEnabled(data.enabled ?? true);
        setActivationRule(data.activationRule ?? (data.enabled ? 'fallback' : 'disabled'));
        setFallbackSeconds(typeof data.fallbackSeconds === 'number' ? data.fallbackSeconds : 120);
        setModelsText(Array.isArray(data.models) ? data.models.join('\n') : '');
        setStarterTagsText(Array.isArray(data.starterTags) ? data.starterTags.join('\n') : 'highres, 1girl, solo, aesthetic');
      })
      .catch(() => { })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity]);

  // Load the persistent bot duelist roster.
  useEffect(() => {
    let cancelled = false;
    orbitFetch('/api/admin/bots', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { bots?: BotProfileRecord[] } | null) => {
        if (!cancelled && Array.isArray(data?.bots)) setBots(data!.bots as BotProfileRecord[]);
      })
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [identity]);

  const handleSave = async () => {
    if (saving) return;

    setSaving(true);

    const parsedNames = namesText
      .split(/[\n,]+/)
      .map((n) => n.trim())
      .filter(Boolean);

    const parsedModels = modelsText
      .split(/[\n,]+/)
      .map((m) => m.trim())
      .filter(Boolean);

    const payload: BotConfig = {
      providers: providers.map((provider) => ({
        ...provider,
        tags: Array.from(new Set(
          (provider.tags || [])
            .map((tag) => tag.trim().toLowerCase().replace(/^#/, ''))
            .filter(Boolean)
        )),
        name: provider.name.trim(),
        url: provider.url.trim(),
        apiKey: provider.apiKey?.trim() || '',
        userId: provider.userId?.trim() || '',
      })),
      tags: Array.from(new Set(
        globalTags
          .map((tag) => tag.trim().toLowerCase().replace(/^#/, ''))
          .filter(Boolean)
      )),
      names: parsedNames,
      enabled,
      activationRule,
      fallbackSeconds: Math.max(0, Math.floor(Number(fallbackSeconds) || 0)),
      models: parsedModels,
      starterTags: starterTagsText
        .split(/[\n,]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    };

    try {
      const res = await orbitFetch(
        '/api/admin/bot-config',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        identity
      );

      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const errorData = await res.json();
          if (typeof errorData?.error === 'string') message = errorData.error;
          else if (typeof errorData?.message === 'string') message = errorData.message;
        } catch {
          // Keep the HTTP status as the fallback error.
        }

        throw new Error(message);
      }

      /*
       * The PUT response only proves that the endpoint accepted the request.
       * Re-read the configuration to verify that the persisted backend state
       * actually matches what we just saved.
       */
      const verifyRes = await orbitFetch(
        '/api/admin/bot-config',
        {},
        identity
      );

      if (!verifyRes.ok) {
        throw new Error(
          `Settings were accepted but could not be verified (HTTP ${verifyRes.status}).`
        );
      }

      const persisted = (await verifyRes.json()) as BotConfig;

      // Normalize the server response back into the exact UI state.
      const persistedProviders = Array.isArray(persisted.providers)
        ? persisted.providers
        : [];

      const persistedTags = Array.isArray(persisted.tags)
        ? persisted.tags
        : typeof (persisted as any).tags === 'string'
          ? (persisted as any).tags
            .split(/[\n,]+/)
            .map((tag: string) => tag.trim())
            .filter(Boolean)
          : [];

      setProviders(persistedProviders);
      setSelectedTestProviderId((current) =>
        current && persistedProviders.some((provider) => provider.id === current)
          ? current
          : persistedProviders[0]?.id || null
      );
      setGlobalTags(persistedTags);
      setNamesText(
        Array.isArray(persisted.names)
          ? persisted.names.join('\n')
          : ''
      );
      setEnabled(persisted.enabled ?? true);
      setActivationRule(
        persisted.activationRule ??
        (persisted.enabled ? 'fallback' : 'disabled')
      );
      setFallbackSeconds(
        typeof persisted.fallbackSeconds === 'number'
          ? persisted.fallbackSeconds
          : 120
      );
      setModelsText(
        Array.isArray(persisted.models)
          ? persisted.models.join('\n')
          : ''
      );

      toast('Bot & Search Tags settings saved and verified.', 'success');
    } catch (error) {
      logger.error('[BotSetupPanel] Failed to persist bot settings:', error);

      toast(
        error instanceof Error
          ? `Failed to save bot settings: ${error.message}`
          : 'Failed to save bot settings',
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleApplyGlobalTagsToAllProviders = () => {
    setProviders(providers.map((p) => ({ ...p, tags: [...globalTags] })));
    toast('Applied default query to all active providers.', 'success');
  };

  const handleApplyTagPreset = (presetTags: string[]) => {
    setGlobalTags(presetTags);
    toast('Loaded search query preset', 'info');
  };

  const handleTestConnection = async (targetProvider?: BotApiProvider) => {
    const provider = targetProvider || providers.find((p) => p.id === selectedTestProviderId) || providers[0];
    if (!provider) {
      toast('Please select or add an API provider to test', 'error');
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const res = await orbitFetch(
        '/api/admin/bot-config/test',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider }),
        },
        identity
      );

      if (res.ok) {
        const result: ApiTestResult = await res.json();
        setTestResult(result);
        if (result.ok) {
          toast(`Connected to ${provider.name}. Found ${result.foundCount} images (${result.latencyMs}ms)`, 'success');
        } else {
          toast(`Test Failed: ${result.error || 'Check diagnostics logs'}`, 'error');
        }
      } else {
        toast('Failed to execute API diagnostic', 'error');
      }
    } catch {
      toast('Network error during API test', 'error');
    } finally {
      setTesting(false);
    }
  };

  const handleSyncImages = async () => {
    setSyncing(true);
    try {
      const res = await orbitFetch('/api/admin/bot-config/sync-images', { method: 'POST' }, identity);
      if (res.ok) {
        const data = await res.json();
        toast(`Synced ${data.cachedCount} fresh cards across active providers.`, 'success');
      } else {
        toast('Failed to sync bot images', 'error');
      }
    } catch {
      toast('Error syncing images', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleAddPreset = (preset: typeof PRESET_PROVIDERS[0]) => {
    const newProv: BotApiProvider = {
      ...preset,
      id: makeProviderId(),
    };
    setProviders([...providers, newProv]);
    setEditingProviderId(newProv.id);
    setSelectedTestProviderId(newProv.id);
    toast(`Added ${preset.name} to providers pool`, 'info');
  };

  const handleUpdateProvider = (id: string, updates: Partial<BotApiProvider>) => {
    setProviders((current) =>
      current.map((provider) =>
        provider.id === id ? { ...provider, ...updates } : provider
      )
    );
  };

  const handleDeleteProvider = (id: string) => {
    if (providers.length <= 1) {
      toast('Keep at least one provider in the pool.', 'error');
      return;
    }

    setProviders((current) => {
      const next = current.filter((provider) => provider.id !== id);

      if (selectedTestProviderId === id) {
        setSelectedTestProviderId(next[0]?.id || null);
      }

      return next;
    });

    setSelectedProviderIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    toast('Provider removed', 'info');
  };

  // ─── Batch Provider Operations ───
  const toggleProviderSelection = (id: string) => {
    setSelectedProviderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllProviders = () => {
    if (selectedProviderIds.size === providers.length) {
      setSelectedProviderIds(new Set());
    } else {
      setSelectedProviderIds(new Set(providers.map((p) => p.id)));
    }
  };

  const handleBatchEnable = (enabled: boolean) => {
    setProviders((current) =>
      current.map((p) =>
        selectedProviderIds.has(p.id) ? { ...p, enabled } : p
      )
    );
    toast(`${enabled ? 'Enabled' : 'Disabled'} ${selectedProviderIds.size} provider(s)`, 'success');
  };

  const handleBatchDelete = () => {
    if (selectedProviderIds.size >= providers.length) {
      toast('Keep at least one provider in the pool.', 'error');
      return;
    }
    setProviders((current) => {
      const next = current.filter((p) => !selectedProviderIds.has(p.id));
      if (selectedTestProviderId && !next.some((p) => p.id === selectedTestProviderId)) {
        setSelectedTestProviderId(next[0]?.id || null);
      }
      return next;
    });
    setSelectedProviderIds(new Set());
    toast(`Deleted ${selectedProviderIds.size} provider(s)`, 'info');
  };

  const handleBatchApplyGlobalQuery = () => {
    setProviders((current) =>
      current.map((p) =>
        selectedProviderIds.has(p.id) ? { ...p, tags: [...globalTags] } : p
      )
    );
    toast('Applied default query to selected providers', 'success');
  };

  const handleApplyNamePreset = (category: keyof typeof PRESET_NAMES) => {
    setNamesText(PRESET_NAMES[category].join('\n'));
    toast(`Loaded ${category} bot names`, 'info');
  };

  // ─── Persistent bot duelist profiles ───
  const updateBotLocal = (id: string, updates: Partial<BotProfileRecord>) => {
    setBots((prev) => prev.map((b) => (b.id === id ? { ...b, ...updates } : b)));
    setDirtyBotIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const saveRoster = async () => {
    if (dirtyBotIds.size === 0) {
      toast('No changes to save.', 'info');
      return;
    }
    const dirtyBots = bots.filter((b) => dirtyBotIds.has(b.id));
    let savedCount = 0;
    for (const bot of dirtyBots) {
      const res = await orbitFetch(`/api/admin/bots/${bot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: bot.name, tags: bot.tags, enabled: bot.enabled }),
      }, identity);
      if (res.ok) {
        const data = await res.json();
        if (data.bot) updateBotLocal(data.bot.id, data.bot);
        savedCount++;
      }
    }
    setDirtyBotIds(new Set());
    toast(`Saved ${savedCount} bot profile(s).`, 'success');
  };

  const deleteBot = async (bot: BotProfileRecord) => {
    const res = await orbitFetch(`/api/admin/bots/${bot.id}`, { method: 'DELETE' }, identity);
    if (res.ok) {
      setBots((prev) => prev.filter((b) => b.id !== bot.id));
      toast('Bot removed.', 'info');
    } else {
      const data = await res.json().catch(() => null);
      toast(data?.error || 'Failed to remove bot.', 'error');
    }
  };

  const runBotPicture = async (bot: BotProfileRecord, customUrl?: string) => {
    setBotsBusyId(bot.id);
    try {
      const res = await orbitFetch(`/api/admin/bots/${bot.id}/picture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customUrl ? { customUrl } : {}),
      }, identity);
      if (res.ok) {
        const data = await res.json();
        if (data.bot) updateBotLocal(data.bot.id, data.bot);
        toast(customUrl ? 'Bot picture updated.' : 'Bot picture generated from its tags.', 'success');
      } else {
        const data = await res.json().catch(() => null);
        toast(data?.error || 'Could not set the picture.', 'error');
      }
    } finally {
      setBotsBusyId(null);
    }
  };

  const addBot = async () => {
    const name = newBotName.trim();
    if (!name) {
      toast('Enter a bot name.', 'error');
      return;
    }
    const tags = newBotTags.split(/[\n,]+/).map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
    const res = await orbitFetch('/api/admin/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tags }),
    }, identity);
    if (res.ok) {
      const data = await res.json();
      if (data.bot) setBots((prev) => [...prev, data.bot]);
      setNewBotName('');
      setNewBotTags('');
      toast('Bot created.', 'success');
    } else {
      const data = await res.json().catch(() => null);
      toast(data?.error || 'Failed to create bot.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-xs font-mono text-retro-muted animate-pulse">
        Loading Bot Multi-API configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans select-none">
      {/* Header Banner */}
      <section className="bg-[#18181b] border border-[#27272a] rounded-xl p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-purple-500/30 flex items-center justify-center text-cyan-300 shadow-md">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-retro-fg uppercase tracking-wider flex items-center gap-2">
              <span>Bot Duelist &amp; Multi-API Management</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${enabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-red-500/20 text-red-300 border border-red-500/40'}`}>
                {enabled ? 'Bots Active' : 'Bots Disabled'}
              </span>
            </h2>
            <p className="text-xs text-retro-muted mt-0.5">
              Multi-API image search, booru query formatting, opponent tag matching, and ephemeral placeholder isolation.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleSyncImages}
            disabled={syncing}
            className="px-3 py-2 bg-[#27272a] hover:bg-glass-w10 text-retro-fg border border-[#27272a] rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-cyan-300' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Card Cache'}</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95 shadow-md shadow-purple-950/50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save All Settings'}</span>
          </button>
        </div>
      </section>

      {/* Info Notice: Tag Matching & Ephemeral Storage */}
      <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 flex items-start gap-3 text-xs text-retro-fg">
        <Sparkles className="w-5 h-5 text-cyan-300 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold text-retro-fg">Dynamic Player Tag Matching Active</span>
          <p className="text-retro-muted leading-relaxed">
            During arcade matches, AI bots automatically inspect the human opponent&apos;s tags (e.g. <code className="text-cyan-300 font-semibold">#cyberpunk</code>, <code className="text-cyan-300 font-semibold">#waifu</code>) and search the active API pool for matching cards. If no tags are set or 0 results match, bots seamlessly fall back to each provider&apos;s tag pool. Bot cards remain ephemeral and never pollute database storage.
          </p>
        </div>
      </div>

      {/* Activation Rules */}
      <section className="bg-[#18181b] border border-[#27272a] rounded-xl p-5 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 border-b border-[#27272a] pb-3">
          <Sliders className="w-4 h-4 text-cyan-300" />
          <span className="text-xs font-bold uppercase tracking-wider text-retro-fg">Bot Activation Rules</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider">Activation Rule</label>
            <select
              value={activationRule}
              onChange={(e) => setActivationRule(e.target.value as BotActivationRule)}
              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-xs text-retro-fg outline-none focus:border-purple-500"
            >
              <option value="immediate">Immediate — bots duel instantly</option>
              <option value="fallback">Fallback — bots join after wait time</option>
              <option value="manual_only">Manual Only — admin-triggered bots</option>
              <option value="disabled">Disabled — no bots</option>
            </select>
            <p className="text-[10px] text-retro-muted leading-relaxed">
              Controls when bots may pair with waiting players and the Quick Match button.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider">Fallback Wait (seconds)</label>
            <input
              type="number"
              min={0}
              value={fallbackSeconds}
              onChange={(e) => setFallbackSeconds(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-xs text-retro-fg font-mono outline-none focus:border-purple-500"
            />
            <p className="text-[10px] text-retro-muted leading-relaxed">
              How long a lone player waits before a bot fills in (fallback rule).
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider">Landing Page Models (one per line)</label>
            <textarea
              value={modelsText}
              onChange={(e) => setModelsText(e.target.value)}
              rows={3}
              placeholder={'flux\nsd-xl\nanime\nphotoreal'}
              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-xs text-retro-fg font-mono outline-none focus:border-purple-500 resize-y"
            />
            <p className="text-[10px] text-retro-muted leading-relaxed">
              Model choices surfaced on the public login-page slideshow selector.
            </p>
          </div>
        </div>
      </section>

      {/* Main Grid: Multi-API List Left (7 cols) + Diagnostics Right (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-7 space-y-6">

          {/* 0. Global Search Tags Manager */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5 space-y-4 shadow-xs">
<div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-retro-fg">
                <Tag className="w-4 h-4 text-cyan-300" />
                <span>Default API Search & Bot Query ({globalTags.length})</span>
              </div>
              <button
                type="button"
                onClick={handleApplyGlobalTagsToAllProviders}
                className="px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/15 text-cyan-300 border border-purple-300 rounded-lg text-xs font-bold uppercase tracking-wide transition-all cursor-pointer shadow-xs active:scale-95"
                title="Sync this query to all API providers below"
              >
                Apply to All Providers
              </button>
            </div>

            {/* Quick Query Presets */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider">Quick Presets:</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { name: 'Anime / Waifu', tags: ['1girl', 'solo', 'scenery', 'highres'] },
                  { name: 'Cyberpunk', tags: ['cyberpunk', 'neon', 'futuristic', 'sci-fi'] },
                  { name: 'Fantasy Scenery', tags: ['scenery', 'landscape', 'fantasy', 'sky'] },
                  { name: 'Game CG', tags: ['game_cg', 'wallpaper', 'official_art'] },
                  { name: 'Clean (Anti-AI)', tags: ['1girl', 'solo', 'highres', '-ai_generated', '-3d'] },
                ].map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => handleApplyTagPreset(preset.tags)}
                    className="px-2 py-0.5 text-xs font-medium rounded-lg border border-[#27272a] bg-[#27272a] hover:bg-cyan-500/10 hover:border-purple-300 text-retro-fg hover:text-cyan-300 transition-all cursor-pointer"
                  >
                    + {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <BooruQueryBox
              value={globalTags}
              onChange={setGlobalTags}
              placeholder="Type booru query (e.g. 1girl solo -ai_generated -bikini)..."
              suggestions={[
                '1girl',
                'solo',
                'scenery',
                'highres',
                'wallpaper',
                'cyberpunk',
                'game_cg',
                'waifu',
                '-ai_generated',
                '-3d',
                '-bikini',
                '-lowres',
              ]}
              label="Default Query"
              showPreview={true}
            />
          </div>

          {/* 1. Multi-API Provider Manager */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-retro-fg">
                <Globe className="w-4 h-4 text-cyan-300" />
                <span>1. Multi-API Image Providers Pool ({providers.length})</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-retro-fg font-semibold">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="w-4 h-4 accent-purple-500 rounded cursor-pointer"
                />
                <span>Enable AI Bots</span>
              </label>
            </div>

            {/* Batch Action Bar */}
            {selectedProviderIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl">
                <label className="flex items-center gap-1.5 text-xs text-cyan-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedProviderIds.size === providers.length}
                    onChange={toggleSelectAllProviders}
                    className="w-3.5 h-3.5 accent-cyan-500 rounded cursor-pointer"
                  />
                  <span>Select All ({providers.length})</span>
                </label>
                <div className="flex items-center gap-1.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => handleBatchEnable(true)}
                    className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Enable
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBatchEnable(false)}
                    className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/50 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Disable
                  </button>
                  <button
                    type="button"
                    onClick={handleBatchApplyGlobalQuery}
                    className="px-2.5 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/50 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Apply Global Query
                  </button>
                  <button
                    type="button"
                    onClick={handleBatchDelete}
                    className="px-2.5 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/50 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Delete Selected
                  </button>
                </div>
              </div>
            )}

            {/* Quick Add Preset Bar */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-retro-muted uppercase tracking-wider">Quick Add Provider Preset:</label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_PROVIDERS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => handleAddPreset(preset)}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg border border-[#27272a] bg-[#27272a] hover:bg-cyan-500/10 hover:border-purple-300 text-retro-fg hover:text-cyan-300 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3 text-cyan-300" />
                    <span>{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Providers List Accordion / Cards */}
            <div className="space-y-3">
              {providers.map((prov) => {
                const isEditing = editingProviderId === prov.id;
                const isSelectedForTest = selectedTestProviderId === prov.id;
                const isShowKey = showKeyFor[prov.id];

                return (
                  <div
                    key={prov.id}
                    className={`border rounded-xl transition-all ${isSelectedForTest
                        ? 'border-purple-400 bg-cyan-500/10/40 shadow-xs'
                        : 'border-[#27272a] bg-[#18181b]'
                      }`}
                  >
                    {/* Provider Row Header */}
                    <div className="p-3.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedProviderIds.has(prov.id)}
                            onChange={() => toggleProviderSelection(prov.id)}
                            className="w-3.5 h-3.5 accent-cyan-500 rounded cursor-pointer"
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => handleUpdateProvider(prov.id, { enabled: !prov.enabled })}
                          className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors cursor-pointer ${prov.enabled ? 'bg-emerald-500 text-white' : 'bg-glass-w20 text-retro-muted'
                            }`}
                          title={prov.enabled ? 'Active provider' : 'Disabled provider'}
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </button>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-retro-fg truncate">{prov.name}</span>
                            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.2 rounded bg-[#27272a] text-retro-muted border border-[#27272a]">
                              {prov.providerType}
                            </span>
                          </div>
                          <p className="text-[10px] text-retro-muted truncate font-mono mt-0.5">
                            {prov.url}
                          </p>
                        </div>
                      </div>

                      {/* Provider Action Buttons */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTestProviderId(prov.id);
                            handleTestConnection(prov);
                          }}
                          disabled={testing}
                          className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                          title="Run live diagnostic for this provider"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Test</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setEditingProviderId(isEditing ? null : prov.id)}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${isEditing
                              ? 'bg-cyan-500 text-white border-purple-500'
                              : 'bg-[#27272a] text-retro-muted hover:text-retro-fg border-[#27272a]'
                            }`}
                          title="Edit provider settings"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteProvider(prov.id)}
                          className="p-1.5 rounded-lg bg-[#27272a] hover:bg-red-50 text-retro-muted hover:text-red-600 border border-[#27272a] transition-colors cursor-pointer"
                          title="Remove provider"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Provider Editor */}
                    {isEditing && (
                      <div className="p-4 border-t border-[#27272a] bg-[#18181b] space-y-4 rounded-b-xl">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Name */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider">Provider Label:</label>
                            <input
                              type="text"
                              value={prov.name}
                              onChange={(e) => handleUpdateProvider(prov.id, { name: e.target.value })}
                              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-1.5 text-xs text-retro-fg outline-none focus:border-purple-500"
                            />
                          </div>

                          {/* Provider Type */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider">Provider Engine:</label>
                            <select
                              value={prov.providerType}
                              onChange={(e) => handleUpdateProvider(prov.id, { providerType: e.target.value as ProviderType })}
                              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-xs text-retro-fg outline-none focus:border-purple-500"
                            >
                              <option value="gelbooru">Gelbooru (api_key + user_id)</option>
                              <option value="danbooru">Danbooru (Basic Auth / login)</option>
                              <option value="waifu_im">Waifu.im (Keyless / Token)</option>
                              <option value="nekos_best">Nekos.best (Keyless)</option>
                              <option value="safebooru">Safebooru (Keyless)</option>
                              <option value="e621">e621 (User Agent + Auth)</option>
                              <option value="generic">Generic JSON Endpoint</option>
                            </select>
                          </div>

                          {/* Weight / Priority */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider">Weight (Priority):</label>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={prov.weight || 10}
                              onChange={(e) => handleUpdateProvider(prov.id, { weight: Math.max(1, Math.min(100, Number(e.target.value) || 10)) })}
                              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-1.5 text-xs text-retro-fg font-mono outline-none focus:border-purple-500"
                            />
                            <p className="text-[10px] text-retro-muted">Higher weight = more likely to be selected for image fetching.</p>
                          </div>
                        </div>

                        {/* URL */}
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider">API URL Endpoint:</label>
                          <input
                            type="text"
                            value={prov.url}
                            onChange={(e) => handleUpdateProvider(prov.id, { url: e.target.value })}
                            className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-1.5 text-xs font-mono text-retro-fg outline-none focus:border-purple-500"
                          />
                        </div>

                        {/* Auth Credentials: API Key & User ID */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* API Key */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider">API Key / Token:</label>
                              <button
                                type="button"
                                onClick={() => setShowKeyFor({ ...showKeyFor, [prov.id]: !isShowKey })}
                                className="text-[10px] text-cyan-300 hover:text-cyan-300 font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                {isShowKey ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                                <span>{isShowKey ? 'Hide' : 'Show'}</span>
                              </button>
                            </div>
                            <input
                              type={isShowKey ? 'text' : 'password'}
                              value={prov.apiKey || ''}
                              onChange={(e) => handleUpdateProvider(prov.id, { apiKey: e.target.value })}
                              placeholder="api_key parameter or token..."
                              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-1.5 text-xs font-mono text-retro-fg outline-none focus:border-purple-500"
                            />
                          </div>

                          {/* User ID / Login (Crucial for Gelbooru & Danbooru) */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider">User ID / Login (Gelbooru &amp; Danbooru):</label>
                            <input
                              type="text"
                              value={prov.userId || ''}
                              onChange={(e) => handleUpdateProvider(prov.id, { userId: e.target.value })}
                              placeholder="Gelbooru user_id or Danbooru login username..."
                              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-1.5 text-xs font-mono text-retro-fg outline-none focus:border-purple-500"
                            />
                          </div>
                        </div>

                        {/* Tag Pool for this provider */}
                        <BooruQueryBox
                          value={prov.tags}
                          onChange={(tags) => handleUpdateProvider(prov.id, { tags })}
                          placeholder="Type booru query (e.g. 1girl solo -ai_generated -bikini)..."
                          suggestions={[
                            '1girl',
                            'solo',
                            'scenery',
                            'highres',
                            'wallpaper',
                            'cyberpunk',
                            'game_cg',
                            'waifu',
                            '-ai_generated',
                            '-3d',
                            '-bikini',
                            '-lowres',
                          ]}
                          label="Provider Fallback Query"
                          showPreview={true}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Bot Names List Configuration */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-retro-fg">
                <Users className="w-4 h-4 text-amber-400" />
                <span>2. Dynamic Bot Identities &amp; Names Pool</span>
              </div>
              <div className="flex items-center gap-1">
                {(['cyberpunk', 'anime', 'mythic'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => handleApplyNamePreset(cat)}
                    className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-[#27272a] hover:bg-glass-w10 text-retro-muted hover:text-retro-fg border border-[#27272a] transition-colors cursor-pointer"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-retro-muted uppercase tracking-wider">
                Bot Name Pool (One name per line):
              </label>
              <textarea
                value={namesText}
                onChange={(e) => setNamesText(e.target.value)}
                rows={4}
                placeholder="Aria&#10;Chrono&#10;Eclipse&#10;Valkyrie&#10;Sol..."
                className="w-full bg-[#18181b] border border-[#27272a] focus:border-purple-500 rounded-xl p-3 text-xs text-retro-fg font-mono outline-none resize-y leading-relaxed transition-colors"
              />
              <p className="text-[10px] text-retro-muted">
                Bots randomly pick names from this pool instead of generic tags, creating dynamic, lively duelists.
              </p>
            </div>
          </div>

          {/* Bot Duelist Profiles: persistent per-bot identity */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-retro-fg">
                <Bot className="w-4 h-4 text-emerald-400" />
                <span>Bot Duelist Profiles</span>
                <span className="text-[10px] font-normal text-retro-muted normal-case">({bots.filter((b) => b.enabled).length} active)</span>
                {dirtyBotIds.size > 0 && (
                  <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                    {dirtyBotIds.size} unsaved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => orbitFetch('/api/admin/bots', {}, identity).then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d?.bots)) setBots(d.bots); })}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium text-retro-fg hover:text-white bg-[#1f1f23] hover:bg-[#27272a] border border-[#27272a] rounded-lg transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  Refresh
                </button>
                {dirtyBotIds.size > 0 && (
                  <button
                    onClick={saveRoster}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save Roster ({dirtyBotIds.size})
                  </button>
                )}
              </div>
            </div>

            <p className="text-xs text-retro-muted leading-relaxed">
              Each duelist has its own name, booru search tags, and picture. Pictures are generated from the bot&apos;s
              tags against your active providers, or you can paste a manual URL. Changes are saved persistently and
              appear in the match queue roster immediately.
            </p>

            {bots.length === 0 && (
              <div className="text-center py-6 text-xs font-mono text-retro-muted animate-pulse">
                Loading bot profiles...
              </div>
            )}

            {bots.map((bot) => (
              <div
                key={bot.id}
                className={`border rounded-xl p-3.5 space-y-3 ${
                  dirtyBotIds.has(bot.id)
                    ? 'border-amber-500/50 bg-amber-500/5'
                    : 'border-[#27272a] bg-[#1a1a1e]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-full overflow-hidden bg-[#27272a] flex items-center justify-center border border-[#27272a] shrink-0">
                    {bot.pfp_url ? (
                      <img
                        src={bot.pfp_url}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-retro-muted" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <input
                      value={bot.name}
                      onChange={(e) => updateBotLocal(bot.id, { name: e.target.value })}
                      placeholder="Bot name"
                      className="w-full bg-[#18181b] border border-[#27272a] focus:border-emerald-500 rounded-lg px-2.5 py-2 text-xs text-retro-fg outline-none transition-colors"
                    />
                    <BooruQueryBox
                      value={bot.tags}
                      onChange={(tags) => updateBotLocal(bot.id, { tags })}
                      placeholder="Type booru query (e.g. 1girl solo -ai_generated)..."
                      suggestions={[
                        '1girl',
                        'solo',
                        'scenery',
                        'highres',
                        'wallpaper',
                        'cyberpunk',
                        'game_cg',
                        'waifu',
                        '-ai_generated',
                        '-3d',
                        '-bikini',
                        '-lowres',
                      ]}
                      label="Search Query"
                      showPreview={false}
                    />
                    <label className="flex items-center gap-1.5 text-[10px] text-retro-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bot.enabled}
                        onChange={(e) => updateBotLocal(bot.id, { enabled: e.target.checked })}
                        className="w-3.5 h-3.5 accent-emerald-500"
                      />
                      Active
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => runBotPicture(bot)}
                    disabled={botsBusyId === bot.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium text-retro-fg hover:text-white bg-[#1f1f23] hover:bg-[#27272a] border border-[#27272a] rounded-lg transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${botsBusyId === bot.id ? 'animate-spin' : ''}`} />
                    {botsBusyId === bot.id ? 'Working...' : 'Generate picture'}
                  </button>
                  <input
                    value={customUrlFor[bot.id] || ''}
                    onChange={(e) => setCustomUrlFor((prev) => ({ ...prev, [bot.id]: e.target.value }))}
                    placeholder="Manual picture URL (optional)"
                    className="flex-1 min-w-[180px] bg-[#18181b] border border-[#27272a] focus:border-purple-500 rounded-lg px-2.5 py-1.5 text-xs text-retro-fg outline-none transition-colors"
                  />
                  <button
                    onClick={() => runBotPicture(bot, customUrlFor[bot.id]?.trim())}
                    disabled={botsBusyId === bot.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium text-retro-fg hover:text-white bg-[#1f1f23] hover:bg-[#27272a] border border-[#27272a] rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Check className="w-3 h-3" />
                    Set URL
                  </button>
                  <button
                    onClick={() => deleteBot(bot)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>
              </div>
            ))}

            <div className="border-t border-[#27272a] pt-4 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-retro-muted">Create new duelist</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  value={newBotName}
                  onChange={(e) => setNewBotName(e.target.value)}
                  placeholder="Bot name"
                  className="w-full bg-[#18181b] border border-[#27272a] focus:border-emerald-500 rounded-lg px-2.5 py-2 text-xs text-retro-fg outline-none transition-colors"
                />
                <input
                  value={newBotTags}
                  onChange={(e) => setNewBotTags(e.target.value)}
                  placeholder="tags, comma separated"
                  className="w-full bg-[#18181b] border border-[#27272a] focus:border-emerald-500 rounded-lg px-2.5 py-2 text-xs text-retro-fg font-mono outline-none transition-colors"
                />
              </div>
              <button
                onClick={addBot}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-purple-600/80 hover:bg-purple-500 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add bot
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Live Test Diagnostics & Sample Image Previews */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-retro-fg">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span>Connection Diagnostics</span>
              </div>
              <button
                type="button"
                onClick={() => handleTestConnection()}
                disabled={testing}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95 shadow-xs"
              >
                <Play className={`w-3.5 h-3.5 fill-current ${testing ? 'animate-spin' : ''}`} />
                <span>{testing ? 'Testing...' : 'Test Selected API'}</span>
              </button>
            </div>

            {/* Test Results Banner */}
            {testResult && (
              <div className={`p-4 rounded-xl border space-y-3 ${testResult.ok ? 'bg-emerald-50/80 border-emerald-300 text-emerald-900' : 'bg-rose-50/80 border-rose-300 text-rose-900'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {testResult.ok ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
                    )}
                    <div>
                      <h4 className="text-xs font-extrabold uppercase tracking-wide text-retro-fg">
                        {testResult.ok ? 'API Connected Cleanly' : 'Connection Failed'}
                      </h4>
                      <p className="text-xs text-retro-muted font-mono">
                        HTTP {testResult.status} {testResult.statusText} • {testResult.latencyMs}ms
                      </p>
                    </div>
                  </div>

                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md border ${testResult.ok ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300'}`}>
                    {testResult.foundCount} Images
                  </span>
                </div>

                {testResult.error && (
                  <div className="p-2.5 bg-rose-100/80 border border-rose-300 rounded-lg text-xs text-rose-900 font-mono leading-relaxed">
                    {testResult.error}
                  </div>
                )}
              </div>
            )}

            {/* Live Sample Images Preview Grid */}
            {testResult?.sampleUrls && testResult.sampleUrls.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-retro-muted uppercase tracking-wider">
                  Extracted Image Previews ({testResult.sampleUrls.length}):
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {testResult.sampleUrls.map((imgUrl, i) => (
                    <div
                      key={i}
                      className="aspect-[3/4.2] rounded-xl overflow-hidden bg-[#27272a] border border-[#27272a] relative group"
                    >
                      <img src={imgUrl} alt={`Sample ${i}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Terminal Log Box Header & Copy Action */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-retro-muted uppercase tracking-wider">
                  Execution Logs &amp; Diagnostics Output:
                </label>
                {testResult && (
                  <button
                    type="button"
                    onClick={() => {
                      const text = (testResult.logs || []).join('\n') + (testResult.error ? `\n[ERROR] ${testResult.error}` : '');
                      if (navigator.clipboard) {
                        navigator.clipboard.writeText(text);
                        toast('Logs copied.', 'success');
                      }
                    }}
                    className="text-[10px] font-bold text-cyan-300 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                  >
                    <span>Copy Diagnostics</span>
                  </button>
                )}
              </div>
              <div className="w-full h-56 bg-[#18181b] border border-[#27272a] rounded-xl p-3 font-mono text-xs text-retro-fg overflow-y-auto custom-scrollbar space-y-1">
                {testResult?.logs?.map((line, idx) => (
                  <div
                    key={idx}
                    className={
                      line.startsWith('[ERROR]') || line.startsWith('[EXCEPTION]')
                        ? 'text-red-500 font-bold'
                        : line.startsWith('[WARN]')
                          ? 'text-amber-600'
                          : line.startsWith('[SUCCESS]')
                            ? 'text-emerald-600 font-bold'
                            : line.startsWith('[REQ]') || line.startsWith('[RES]')
                              ? 'text-cyan-300'
                              : 'text-retro-muted'
                    }
                  >
                    {line}
                  </div>
                ))}
                {!testResult && (
                  <div className="text-retro-muted italic py-4 text-center">
                    Select a provider and click &ldquo;Test Selected API&rdquo; to view real-time diagnostics.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 3. Pre-Defined Cards for Newcomers Settings */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-retro-fg">
                <Sparkles className="w-4 h-4 text-cyan-300" />
                <span>3. Newcomer Starter Deck (5 Cards)</span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  toast('Generating 5 starter cards…', 'info');
                  try {
                    const res = await orbitFetch('/api/starter-deck/test', { method: 'POST' }, identity);
                    if (res.ok) {
                      const data = await res.json();
                      if (Array.isArray(data?.cards)) {
                        toast(`Generated ${data.cards.length} starter cards.`, 'success');
                      }
                    }
                  } catch {
                    toast('Error generating starter cards', 'error');
                  }
                }}
                className="px-3 py-1 bg-cyan-500 hover:bg-cyan-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-xs"
              >
                Test Generate 5 Cards
              </button>
            </div>

            <p className="text-xs text-retro-muted leading-relaxed">
              When a newcomer registers on gMatch, a pre-defined starter deck of 5 unique cards is automatically minted for their account so they can immediately participate in duels.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider block mb-1">Primary Source Provider:</label>
                <select
                  value={providers[0]?.id || 'prov_gelbooru'}
                  onChange={(e) => {
                    const prov = providers.find((p) => p.id === e.target.value);
                    if (prov) setSelectedTestProviderId(prov.id);
                  }}
                  className="w-full p-2 bg-[#18181b] border border-[#27272a] rounded-xl text-xs text-retro-fg font-medium outline-none"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.providerType})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider block mb-1">Starter Card Tags Filter:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={starterTagsText}
                    onChange={(e) => setStarterTagsText(e.target.value)}
                    placeholder="highres, 1girl, solo, aesthetic"
                    className="flex-1 p-2 bg-[#18181b] border border-[#27272a] rounded-xl text-xs text-retro-fg font-mono outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-2 bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95 shadow-sm"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Sync
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
