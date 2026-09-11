"use client";

import { useState, useCallback, useEffect, useMemo , useRef} from 'react';
import {
  Monitor,
  Shield,
  Zap,
  Eye,
  Volume2,
  Camera,
  Layers,
  Paintbrush,
  Gamepad2,
  AlertTriangle,
  Loader2,
  Target,
  RefreshCw,
  WifiOff,
  Inbox,
  Radio,
} from 'lucide-react';
import { orbitFetch } from '../../utils/api';
import { useSettings } from '../../hooks/useSettings';
import type { OrbitIdentity } from '@orbit/crypto';
import type { User } from '@orbit/shared';
import { isDefaultPeerName } from '@orbit/shared';
import { ActionModal } from './ActionModal';
import { HacksPanel } from './HacksPanel';
import type { ActiveHackSession } from '../home/HomeFooter';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

interface Props {
  identity: OrbitIdentity | null;
  users: Array<{ id: string; orbitId: string; display_name: string; pfp_url?: string }>;
  /** Full user list for hack targeting (unmapped). */
  allUsers: User[];
  profilePics: Record<string, string>;
  points: number;
  toast: ToastFn;
  activeHack: ActiveHackSession | null;
  setActiveHack: React.Dispatch<React.SetStateAction<ActiveHackSession | null>>;
  onOpenFlash: () => void;
}

interface DominationTarget {
  id: string;
  displayName: string;
  pfpUrl?: string | null;
  enabled: boolean;
  online?: boolean;
  last_seen?: string | null;
  consents?: Record<string, boolean>;
}

/** Every consent key the server stores. Presets spread over this base so a
 * preset tap can never silently drop keys (PUT replaces the whole map). */
export const CONSENT_KEYS = [
  'allowDesktopBackgroundChange',
  'allowGameBackgroundChange',
  'allowPopupVideo',
  'allowPopupMessage',
  'allowTextOverlay',
  'allowBlurEverything',
  'allowRemoteCamera',
  'allowPublicCamera',
  'allowHacks',
] as const;

const ACTION_LABELS: Record<string, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  consent: string;
}> = {
  wallpaper: { label: 'Wallpaper', icon: Paintbrush, description: 'Swaps their desktop background for a while.', consent: 'allowDesktopBackgroundChange' },
  game_bg: { label: 'Game background', icon: Gamepad2, description: 'Covers the app behind them with your image or clip.', consent: 'allowGameBackgroundChange' },
  popup_video: { label: 'Video popup', icon: Volume2, description: 'Full-screen clip on their side. Always starts muted.', consent: 'allowPopupVideo' },
  message: { label: 'Message', icon: AlertTriangle, description: 'A short note pops on their screen.', consent: 'allowPopupMessage' },
  text_overlay: { label: 'Banner text', icon: Layers, description: 'Large text sitting over their screen.', consent: 'allowTextOverlay' },
  blur: { label: 'Blur', icon: Eye, description: 'Blurs their whole view until they dismiss it.', consent: 'allowBlurEverything' },
  camera: { label: 'Photo request', icon: Camera, description: 'Asks their camera for one photo — they approve every request.', consent: 'allowRemoteCamera' },
};

const ACTION_ORDER = Object.keys(ACTION_LABELS);

export const INTENSITY_PRESETS: Record<string, Record<string, boolean>> = {
  mild: {
    allowDesktopBackgroundChange: true,
    allowGameBackgroundChange: false,
    allowPopupVideo: false,
    allowPopupMessage: true,
    allowTextOverlay: true,
    allowBlurEverything: false,
    allowRemoteCamera: false,
    allowHacks: false,
  },
  medium: {
    allowDesktopBackgroundChange: true,
    allowGameBackgroundChange: true,
    allowPopupVideo: true,
    allowPopupMessage: true,
    allowTextOverlay: true,
    allowBlurEverything: true,
    allowRemoteCamera: false,
    allowHacks: false,
  },
  extreme: {
    allowDesktopBackgroundChange: true,
    allowGameBackgroundChange: true,
    allowPopupVideo: true,
    allowPopupMessage: true,
    allowTextOverlay: true,
    allowBlurEverything: true,
    allowRemoteCamera: true,
    allowHacks: true,
  },
};

const CONSENT_ROWS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'allowDesktopBackgroundChange', label: 'Wallpaper', desc: 'Others may replace your desktop background.' },
  { key: 'allowGameBackgroundChange', label: 'Game background', desc: 'Others may cover the app behind you.' },
  { key: 'allowPopupVideo', label: 'Video popup', desc: 'Full-screen clip (muted, dismissible) may appear.' },
  { key: 'allowPopupMessage', label: 'Message', desc: 'A short note may pop on your screen.' },
  { key: 'allowTextOverlay', label: 'Banner text', desc: 'Large text may sit over your screen.' },
  { key: 'allowBlurEverything', label: 'Blur', desc: 'Your whole view may blur for a moment.' },
  { key: 'allowRemoteCamera', label: 'Camera request', desc: 'Others may ask for one photo. You approve every request.' },
  { key: 'allowPublicCamera', label: 'Public photos', desc: 'Camera photos may be posted publicly. Off: they go only to the sender.' },
  { key: 'allowHacks', label: 'Hacks', desc: 'Purchased hacks (screen lock, vision jam) may land on you.' },
];

function currentConsentMap(settings: object): Record<string, boolean> {
  const s = settings as Record<string, unknown>;
  const map: Record<string, boolean> = {};
  for (const k of CONSENT_KEYS) map[k] = Boolean(s[k]);
  return map;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Human one-liner for a stored payload, instead of raw JSON. */
function payloadSummary(action: string, payload: any): string {
  if (!payload || typeof payload !== 'object') return '';
  if (payload.text) return `"${String(payload.text).slice(0, 80)}"`;
  if (payload.url) {
    try {
      const u = new URL(payload.url, 'http://x');
      const file = u.pathname.split('/').pop() || 'media';
      return `media: ${file.slice(0, 48)}`;
    } catch {
      return 'media';
    }
  }
  if (action === 'blur' && payload.intensity != null) return `intensity ${payload.intensity}`;
  if (action === 'camera') return payload.isPublic ? 'public photo request' : 'private photo request';
  return '';
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export function PCDominationTab({ identity, allUsers, profilePics, points, toast: toastFn, activeHack, setActiveHack, onOpenFlash }: Props) {
  const { settings, update } = useSettings();
  const [targets, setTargets] = useState<DominationTarget[]>([]);
  const [targetsState, setTargetsState] = useState<LoadState>('idle');
  const [selectedTarget, setSelectedTarget] = useState<DominationTarget | null>(null);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<any[]>([]);
  const [outgoing, setOutgoing] = useState<any[]>([]);
  const [historyState, setHistoryState] = useState<LoadState>('idle');
  const [historyPane, setHistoryPane] = useState<'incoming' | 'outgoing'>('outgoing');
  const [actionModal, setActionModal] = useState<{ action: string; title: string } | null>(null);

  const receiving = Boolean(settings.pcDominationEnabled);
  const mutedUntil = settings.dominationInboundMutedUntil || 0;
  const paused = mutedUntil > Date.now();

  // ── data loading (explicit state + retry, no silent catch) ────────────
  const loadTargets = useCallback(async () => {
    if (!identity) return;
    setTargetsState('loading');
    try {
      const [targetsRes, settingsRes, pricesRes] = await Promise.all([
        orbitFetch('/api/domination/targets', {}, identity),
        orbitFetch('/api/domination/settings', {}, identity),
        orbitFetch('/api/domination/prices', {}, identity),
      ]);
      if (!targetsRes.ok) throw new Error(`targets ${targetsRes.status}`);
      const data = await targetsRes.json();
      const rawList = Array.isArray(data.targets) ? data.targets : [];
      const list: DominationTarget[] = rawList.filter((t: DominationTarget) => {
        const name = (t.displayName || '').trim();
        return Boolean(name) && !isDefaultPeerName(name);
      });
      setTargets(list);
      setSelectedTarget((prev) => {
        if (!prev) return list[0] || null;
        return list.find((t) => t.id === prev.id) || list[0] || null;
      });
      if (pricesRes.ok) {
        const d = await pricesRes.json().catch(() => null);
        if (d?.prices) setPrices(d.prices);
      }
      if (settingsRes.ok) {
        const serverConfig = await settingsRes.json().catch(() => null);
        if (typeof serverConfig?.enabled === 'boolean' && serverConfig.enabled !== settings.pcDominationEnabled) {
          update('pcDominationEnabled', serverConfig.enabled);
        }
      }
      setTargetsState('ready');
    } catch {
      setTargetsState('error');
    }
  }, [identity, settings.pcDominationEnabled, update]);

  useEffect(() => {
    loadTargets();
  }, [identity]);

  // Light auto-refresh so the online dots don't go stale while you browse.
  useEffect(() => {
    if (!identity) return;
    const t = window.setInterval(() => {
      if (!document.hidden) void loadTargets();
    }, 60_000);
    return () => window.clearInterval(t);
  }, [identity, loadTargets]);

  const loadHistory = useCallback(async () => {
    if (!identity) return;
    setHistoryState('loading');
    try {
      const [inRes, outRes] = await Promise.all([
        orbitFetch('/api/domination/history?limit=100', {}, identity),
        orbitFetch('/api/domination/outgoing?limit=100', {}, identity),
      ]);
      if (!inRes.ok || !outRes.ok) throw new Error('history fetch');
      setHistory(((await inRes.json()).actions) || []);
      setOutgoing(((await outRes.json()).actions) || []);
      setHistoryState('ready');
    } catch {
      setHistoryState('error');
    }
  }, [identity]);

  useEffect(() => {
    if (historyState === 'idle') void loadHistory();
  }, [historyState, loadHistory]);

  // ── consent sync (full map, never partial — server replaces the JSON) ──
  const syncSettingsToServer = useCallback(async (enabled: boolean, consentMap: Record<string, boolean>) => {
    if (!identity) return;
    try {
      await orbitFetch('/api/domination/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, settings: consentMap }),
      }, identity);
    } catch {
      toastFn('Settings saved locally but did not reach the server. Toggle again to retry.', 'warning');
    }
  }, [identity, toastFn]);

  const handleUpdateConsent = (key: string, value: boolean) => {
    update(key as any, value);
    const map = currentConsentMap({ ...settings, [key]: value });
    void syncSettingsToServer(receiving, map);
  };

  const handleUpdateMaster = (enabled: boolean) => {
    update('pcDominationEnabled', enabled);
    void syncSettingsToServer(enabled, currentConsentMap(settings));
  };

  const applyIntensityPreset = (preset: 'mild' | 'medium' | 'extreme') => {
    const newMap = { ...currentConsentMap(settings), ...INTENSITY_PRESETS[preset] };
    for (const [key, value] of Object.entries(newMap)) {
      if (key !== 'allowPublicCamera') update(key as any, value);
    }
    update('dominationIntensity', preset);
    void syncSettingsToServer(receiving, newMap);
    toastFn(`Preset applied: ${preset}`, 'success');
  };

  const togglePause = () => {
    if (paused) {
      update('dominationInboundMutedUntil', 0);
      toastFn('Inbound effects resumed.', 'success');
      return;
    }
    update('dominationInboundMutedUntil', Date.now() + 15 * 60_000);
    window.dispatchEvent(new CustomEvent('gmatch:domination-panic'));
    toastFn('Paused for 15 minutes. Anything sent to you now is dropped.', 'info');
  };

  // ── sending ────────────────────────────────────────────────────────────
  const sendAction = async (action: string, payload: any) => {
    if (!identity || !selectedTarget) return;
    setSending(action);
    try {
      const res = await orbitFetch('/api/domination/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetId: selectedTarget.id,
          action,
          payload,
          intensity: settings.dominationIntensity,
        }),
      }, identity);
      const label = ACTION_LABELS[action]?.label || action;
      if (res.ok) {
        const data = await res.json().catch(() => ({}) as any);
        const cost = typeof data?.cost === 'number' ? data.cost : prices[action];
        const payout = typeof data?.victimReward === 'number' ? data.victimReward : 0;
        const money = typeof cost === 'number' ? ` · -${cost} g$${payout > 0 ? `, they earned +${payout}` : ''}` : '';
        toastFn(`${label} sent to ${selectedTarget.displayName}${money}. Landed status shows in Outbox.`, 'success');
        void loadHistory();
      } else {
        const err = await res.json().catch(() => ({ error: '' }));
        const msg = String(err?.error || '');
        if (res.status === 402) {
          toastFn(msg || `Not enough g$ for ${label}.`, 'error');
        } else if (res.status === 409) {
          toastFn(`${selectedTarget.displayName} just went offline — nothing was charged. Pick someone online.`, 'warning');
          void loadTargets();
        } else if (res.status === 403) {
          toastFn(msg || `${selectedTarget.displayName} has that effect turned off.`, 'warning');
        } else if (res.status === 429) {
          toastFn(msg || 'Slow down — that one was just sent.', 'warning');
        } else {
          toastFn(msg || `Could not send ${label}.`, 'error');
        }
      }
    } catch {
      // We do NOT know if the server processed it. Blind retry could double
      // charge — point the user at the authoritative Outbox instead.
      toastFn('Connection dropped before the server answered. Check Outbox before sending again — you may already have been charged.', 'warning');
      void loadHistory();
    } finally {
      setSending(null);
    }
  };

  const handleModalSubmit = async (payload: any) => {
    if (!actionModal) return;
    setActionModal(null);
    await sendAction(actionModal.action, payload);
  };

  // ── derived ────────────────────────────────────────────────────────────
  const onlineCount = useMemo(() => targets.filter((t) => t.enabled && t.online).length, [targets]);
  const filteredTargets = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? targets.filter((t) => t.displayName.toLowerCase().includes(q))
      : targets;
    return [...list].sort((a, b) => {
      const rank = (t: DominationTarget) => (t.enabled && t.online ? 0 : t.enabled ? 1 : 2);
      return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName);
    });
  }, [targets, search]);

  const consentCountOf = (t: DominationTarget) =>
    ACTION_ORDER.filter((a) => Boolean(t.consents?.[ACTION_LABELS[a].consent])).length;

  // ── unauthenticated shell ─────────────────────────────────────────────
  if (!identity) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 py-16 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-lg glass-inset flex items-center justify-center mb-4">
          <Monitor className="w-6 h-6 text-retro-muted" />
        </div>
        <h2 className="text-base font-semibold tracking-tight">PC Domination</h2>
        <p className="text-sm text-retro-muted mt-2 max-w-md leading-relaxed">
          Log in to use Domination. Switch on <span className="text-retro-fg">Receive</span> to let opted-in
          effects land on your screen, or send effects to players who have.
        </p>
      </div>
    );
  }

  const statusChip = (t: DominationTarget) => {
    if (!t.enabled) return { text: 'blocked', cls: 'text-retro-muted border-border-glass' };
    if (t.online) return { text: 'online', cls: 'text-emerald-400 border-emerald-500/30' };
    return { text: `seen ${timeAgo(t.last_seen)}`, cls: 'text-amber-400/80 border-amber-500/20' };
  };

  const dominationTopRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={dominationTopRef} className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-6 flex flex-col gap-5 font-sans select-none pb-24 lg:pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Monitor className="w-4 h-4 text-retro-muted" />
            PC Domination
          </h1>
          <p className="text-sm text-retro-muted mt-1 max-w-xl leading-relaxed">
            Playful screen pranks between friends who opted in. Every effect costs g$, needs the
            target's consent, and shows up in their history. Nothing lands without a switch you control.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl glass-inset bg-retro-bg/80 px-3 py-2">
          <Radio className={`w-3.5 h-3.5 ${receiving && !paused ? 'text-emerald-400' : 'text-retro-muted'}`} />
          <div className="text-xs leading-tight">
            <div className="font-medium">{receiving ? (paused ? 'Receiving — paused' : 'Receiving effects') : 'Not receiving'}</div>
            <div className="text-retro-muted">Sending is always available</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={receiving}
            onClick={() => handleUpdateMaster(!receiving)}
            className="relative flex h-4 w-9 shrink-0 cursor-pointer items-center border-0 p-0 ml-1"
          >
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 h-1 rounded-full transition-colors ${receiving ? 'bg-emerald-500/50' : 'bg-surface-raised'}`}
            />
            <span
              aria-hidden="true"
              className={`absolute left-0 h-3 w-3 rounded-full shadow transition-transform ${receiving ? 'translate-x-6 bg-emerald-400' : 'translate-x-0 bg-retro-muted'}`}
            />
          </button>
          {receiving && (
            <button
              type="button"
              onClick={togglePause}
              className={`ml-1 px-2 py-1 rounded-md text-xs font-medium border cursor-pointer transition-colors ${
                paused ? 'border-emerald-500/30 text-emerald-400' : 'border-border-glass text-retro-muted hover:text-retro-fg'
              }`}
            >
              {paused ? 'Resume' : 'Pause 15m'}
            </button>
          )}
        </div>
      </div>

      <section aria-label="Send">
        <h3 className="text-xs font-bold text-retro-fg uppercase tracking-wider mt-1">Send</h3>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Target column */}
          <div className="lg:col-span-2 rounded-xl glass-surface flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between gap-2">
              <div className="text-xs font-medium flex items-center gap-1.5 text-retro-fg">
                <Target className="w-3.5 h-3.5 text-retro-muted" /> Target
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-retro-muted">{onlineCount} online</span>
                <button
                  type="button"
                  onClick={() => void loadTargets()}
                  className="p-1 rounded glass-action text-retro-muted hover:text-retro-fg cursor-pointer"
                  aria-label="Refresh targets"
                >
                  <RefreshCw className={`w-3 h-3 ${targetsState === 'loading' ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
            <div className="p-3 border-b border-border-subtle">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search players…"
                className="w-full glass-field rounded-md px-3 py-1.5 text-xs outline-none placeholder:text-retro-muted"
              />
            </div>
            <div className="max-h-[420px] overflow-y-auto styled-scrollbar">
              {targetsState === 'loading' && targets.length === 0 && (
                <div className="p-6 text-center text-xs text-retro-muted flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading players…
                </div>
              )}
              {targetsState === 'error' && (
                <div className="p-6 text-center space-y-3">
                  <p className="text-xs text-rose-400">Couldn't load the player list.</p>
                  <button
                    type="button"
                    onClick={() => void loadTargets()}
                    className="glass-action glass-action-primary px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer"
                  >
                    Try again
                  </button>
                </div>
              )}
              {targetsState === 'ready' && filteredTargets.length === 0 && (
                <div className="p-6 text-center space-y-3">
                  <WifiOff className="w-5 h-5 mx-auto text-retro-muted" />
                  <p className="text-xs text-retro-muted">
                    {search ? 'No player matches that name.' : 'Nobody has Domination switched on yet.'}
                  </p>
                  {!search && (
                    <button
                      type="button"
                      onClick={() => document.getElementById('pc-dom-consent')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className="glass-action glass-action-primary px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors"
                    >
                      Set up my consent
                    </button>
                  )}
                </div>
              )}
              {filteredTargets.map((t) => {
                const chip = statusChip(t);
                const isSel = selectedTarget?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTarget(t)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-border-subtle transition-colors cursor-pointer ${
                      isSel ? 'glass-nav-active' : 'hover:bg-surface-interactive/60'
                    }`}
                  >
                    {t.pfpUrl ? (
                      <img src={t.pfpUrl} alt="" className="w-7 h-7 rounded-md object-cover border border-border-glass" />
                    ) : (
                      <div className="w-7 h-7 rounded-md glass-inset flex items-center justify-center text-xs font-semibold text-retro-fg">
                        {t.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate text-retro-fg">{t.displayName}</div>
                      <div className="text-[10px] text-retro-muted">{consentCountOf(t)}/7 effects allowed</div>
                    </div>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${chip.cls}`}>{chip.text}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Effects column */}
          <div className="lg:col-span-3 space-y-3">
            {!selectedTarget ? (
              <div className="rounded-xl border border-dashed border-border-glass p-10 text-center text-sm text-retro-muted">
                Pick a target on the left to start.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-xl glass-inset bg-retro-bg/80 px-4 py-2.5">
                  <div className="text-xs text-retro-fg">
                    Effects for <span className="font-semibold">{selectedTarget.displayName}</span>
                    {selectedTarget.enabled && !selectedTarget.online && (
                      <span className="text-amber-400/80"> · offline, sends will be refused (free)</span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-retro-muted">{points.toLocaleString()} g$</div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ACTION_ORDER.map((action) => {
                    const { label, icon: Icon, description, consent } = ACTION_LABELS[action];
                    const allowed = Boolean(selectedTarget.consents?.[consent]);
                    const sendable = allowed && Boolean(selectedTarget.enabled) && selectedTarget.online !== false;
                    const price = prices[action];
                    return (
                      <button
                        key={action}
                        type="button"
                        onClick={() => setActionModal({ action, title: label })}
                        disabled={!sendable || sending === action}
                        title={
                          !selectedTarget.enabled ? 'They have Domination switched off'
                            : !selectedTarget.online ? 'They are offline — nothing would be charged'
                              : !allowed ? `They have "${label}" turned off in their consent`
                                : undefined
                        }
                        className={`rounded-xl border p-4 text-left transition-colors relative ${
                          sending === action
                            ? 'border-retro-accent glass-inset bg-retro-bg/80 cursor-wait'
                            : sendable
                              ? 'border-border-glass glass-inset bg-retro-bg/80 hover:border-retro-accent/60 cursor-pointer'
                              : 'border-border-subtle glass-inset opacity-45 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <Icon className="w-4 h-4 text-retro-muted" />
                          {price != null ? (
                            <span className="text-xs font-mono text-retro-muted">{price} g$</span>
                          ) : (
                            <Zap className="w-3.5 h-3.5 text-retro-muted opacity-40" />
                          )}
                        </div>
                        <div className="text-xs font-semibold text-retro-fg">{label}</div>
                        <div className="text-xs text-retro-muted mt-1 leading-snug">{description}</div>
                        <div className={`mt-2 text-[10px] font-mono ${allowed ? 'text-emerald-400/80' : 'text-retro-muted'}`}>
                          {sending === action ? 'sending…' : allowed ? 'consented' : 'no consent'}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-retro-muted leading-relaxed px-1">
                  Charged only when the server accepts the send. If the connection drops mid-send, check
                  History → Outbox before retrying.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      <section id="pc-dom-consent" aria-label="My consent">
        <h3 className="text-xs font-bold text-retro-fg uppercase tracking-wider mt-1">My consent</h3>
        <div className="space-y-5">
          <div className="rounded-xl glass-surface p-4 space-y-3">
            <div className="text-xs font-medium flex items-center gap-1.5 text-retro-fg">
              <Zap className="w-3.5 h-3.5 text-retro-muted" /> Preset
            </div>
            <p className="text-xs text-retro-muted">
              One-tap starting points for the switches below. Your public-photo setting is never touched.
            </p>
            <div className="flex flex-wrap gap-2">
              {(['mild', 'medium', 'extreme'] as const).map((preset) => {
                const selected = settings.dominationIntensity === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyIntensityPreset(preset)}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-medium border capitalize cursor-pointer transition-colors ${
                      selected ? 'glass-action glass-action-primary' : 'glass-action text-retro-muted hover:text-retro-fg'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl glass-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-retro-muted" />
              <span className="text-xs font-medium text-retro-fg">What others may send you</span>
              {!receiving && <span className="text-[10px] text-retro-muted ml-2">(saved — inactive while Receiving is off)</span>}
            </div>
            <div className="divide-y divide-border-subtle">
              {CONSENT_ROWS.map(({ key, label, desc }) => {
                const value = Boolean((settings as any)[key]);
                return (
                  <label key={key} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-interactive/20 cursor-pointer transition-colors">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={value}
                        aria-label={label}
                        onClick={(e) => {
                          e.preventDefault();
                          handleUpdateConsent(key, !value);
                        }}
                        className="relative flex h-4 w-9 shrink-0 cursor-pointer items-center border-0 p-0 mt-0.5"
                      >
                        <span
                          aria-hidden="true"
                          className={`absolute inset-x-0 h-1 rounded-full transition-colors ${value ? 'bg-emerald-500/50' : 'bg-surface-raised'}`}
                        />
                        <span
                          aria-hidden="true"
                          className={`absolute left-0 h-3 w-3 rounded-full shadow transition-transform ${value ? 'translate-x-6 bg-emerald-400' : 'translate-x-0 bg-retro-muted'}`}
                        />
                      </button>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-retro-fg">{label}</div>
                      <div className="text-xs text-retro-muted leading-snug mt-0.5">{desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section aria-label="History">
        <h3 className="text-xs font-bold text-retro-fg uppercase tracking-wider mt-1">History</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 glass-inset p-0.5 rounded-lg">
              {(['outgoing', 'incoming'] as const).map((pane) => (
                <button
                  key={pane}
                  type="button"
                  onClick={() => setHistoryPane(pane)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize cursor-pointer transition-colors ${
                    historyPane === pane ? 'glass-nav-active text-retro-fg' : 'text-retro-muted hover:text-retro-fg'
                  }`}
                >
                  {pane === 'outgoing' ? 'Sent by you' : 'Received'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void loadHistory()}
              disabled={historyState === 'loading'}
              className="glass-action px-2.5 py-1.5 rounded-md text-xs font-medium text-retro-muted hover:text-retro-fg cursor-pointer flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${historyState === 'loading' ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {historyState === 'loading' && history.length === 0 && outgoing.length === 0 && (
            <div className="py-12 text-center text-xs text-retro-muted flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          )}
          {historyState === 'error' && (
            <div className="py-10 text-center space-y-3">
              <p className="text-xs text-rose-400">Couldn't load history.</p>
              <button
                type="button"
                onClick={() => void loadHistory()}
                className="glass-action glass-action-primary px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer"
              >
                Try again
              </button>
            </div>
          )}
          {historyState === 'ready' && (historyPane === 'outgoing' ? outgoing : history).length === 0 && (
            <div className="py-12 text-center space-y-2 rounded-xl border border-dashed border-border-glass">
              <Inbox className="w-5 h-5 mx-auto text-retro-muted" />
              <p className="text-xs text-retro-muted">
                {historyPane === 'outgoing' ? 'You have not sent anything yet.' : 'Nothing has landed on your screen yet.'}
              </p>
            </div>
          )}
          <div className="space-y-2">
            {(historyPane === 'outgoing' ? outgoing : history).map((action: any) => {
              const meta = ACTION_LABELS[action.action];
              const Icon = meta?.icon || Monitor;
              const st: string = action.status || 'sent';
              const summary = payloadSummary(action.action, typeof action.payload === 'string' ? (() => { try { return JSON.parse(action.payload); } catch { return null; } })() : action.payload);
              const other = historyPane === 'outgoing' ? action.victim_name : action.dominator_name;
              return (
                <div key={action.id} className="flex items-center gap-3 rounded-xl glass-inset px-4 py-3">
                  <Icon className="w-4 h-4 text-retro-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate text-retro-fg">
                      {meta?.label || action.action}
                      {summary && <span className="text-retro-muted font-normal"> — {summary}</span>}
                    </div>
                    <div className="text-xs text-retro-muted truncate">
                      {historyPane === 'outgoing' ? `to ${other || 'unknown'}` : `from ${other || 'unknown'}`}
                      {' · '}{new Date(action.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      st === 'executed'
                        ? 'text-emerald-400 border-emerald-500/30'
                        : st === 'sent'
                          ? 'text-retro-muted border-border-glass'
                          : st === 'expired'
                            ? 'text-amber-400 border-amber-500/30'
                            : 'text-rose-400 border-rose-500/30'
                    }`}
                    title={
                      st === 'sent' ? 'Accepted by the server, waiting for their screen to confirm'
                        : st === 'executed' ? 'Confirmed on their screen'
                          : st === 'expired' ? 'Their client never confirmed it rendered (app closed or camera blocked). Their consent cut stayed paid.'
                            : st
                    }
                  >
                    {st === 'executed' ? 'landed' : st === 'sent' ? (historyPane === 'outgoing' ? 'awaiting' : 'received') : st === 'expired' ? (historyPane === 'outgoing' ? 'fizzled' : 'skipped') : st}
                  </span>
                </div>
              );
            })}
          </div>
          {historyPane === 'outgoing' && historyState === 'ready' && outgoing.length > 0 && (
            <p className="text-xs text-retro-muted px-1">
              <span className="font-mono">awaiting</span> = charged and relayed; it flips to{' '}
              <span className="font-mono text-emerald-400/80">landed</span> once their client confirms, or to{' '}
              <span className="font-mono text-amber-400/80">fizzled</span> after 30 min if it never rendered.
              Camera requests stay <span className="font-mono">awaiting</span> until they approve the photo.
            </p>
          )}
        </div>
      </section>

      <section aria-label="Hacks">
        <h3 className="text-xs font-bold text-retro-fg uppercase tracking-wider mt-1">Hacks</h3>
        <HacksPanel
          identity={identity}
          users={allUsers}
          profilePics={profilePics}
          points={points}
          toast={toastFn}
          activeHack={activeHack}
          setActiveHack={setActiveHack}
          onOpenFlash={onOpenFlash}
          onExitSpy={() => dominationTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      </section>

      {actionModal && (
        <ActionModal
          action={actionModal.action}
          actionTitle={actionModal.title}
          targetName={selectedTarget?.displayName}
          price={prices[actionModal.action]}
          isOpen={Boolean(actionModal)}
          onClose={() => setActionModal(null)}
          onSubmit={handleModalSubmit}
          loading={Boolean(sending)}
        />
      )}
    </div>
  );
}
