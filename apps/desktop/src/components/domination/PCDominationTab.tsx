"use client";

import { useState, useCallback, useEffect, useMemo } from 'react';
import { formatCount } from '../../ui/format';
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
  Target,
  RefreshCw,
  WifiOff,
  Inbox,
  Radio,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  Button,
  Card,
  CardHeader,
  Caption,
  FeedbackState,
  Input,
  PageHeader,
  Tabs,
  Title,
} from '../../ui/kit';
import { Switch } from '../../ui/Switch';
import {
  BUTTON_CONTRACT,
  CHROME,
  COLOR,
  FEEDBACK,
  MONO,
  STATUS,
  TYPE,
  WEIGHT,
} from '../../ui/tokens';
import { orbitFetch } from '../../utils/api';
import { ownDisplayName } from '../../utils/displayName';
import { useSettings } from '../../hooks/useSettings';
import type { OrbitIdentity } from '@orbit/crypto';
import type { User } from '@orbit/shared';
import { isDefaultPeerName } from '@orbit/shared';
import { ActionModal } from './ActionModal';
import { HacksPanel } from './HacksPanel';
import { resolveMediaUrl } from '../../utils/media';
import { formatAbsoluteTime } from '../../utils/timeAgo';
import type { ActiveHackSession } from '../home/CommandIsland';

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
  /** Mesh-first transport (Fase 5/6): sealed courier send, free, no server.
   *  Absent (legacy/no courier) => every send uses the server trigger route. */
  mesh?: {
    peerKnown: (orbitId: string) => boolean;
    send: (
      targetOrbitId: string,
      action: string,
      payload: unknown,
      senderName?: string,
    ) => Promise<{ ok: true; id: string } | { ok: false; reason: string }>;
  };
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
  'allowDesktopWallpaperOS',
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
  wallpaper: { label: 'Wallpaper', icon: Paintbrush, description: 'Swaps their background for a while (OS tier if they allow it).', consent: 'allowDesktopBackgroundChange' },
  game_bg: { label: 'Game background', icon: Gamepad2, description: 'Covers the app behind them with your image or clip.', consent: 'allowGameBackgroundChange' },
  popup_video: { label: 'Video popup', icon: Volume2, description: 'Muted clip in their app. Dismissible.', consent: 'allowPopupVideo' },
  message: { label: 'Message', icon: AlertTriangle, description: 'A short note pops in their app (plus an OS toast).', consent: 'allowPopupMessage' },
  text_overlay: { label: 'Banner text', icon: Layers, description: 'Large text sitting over their app.', consent: 'allowTextOverlay' },
  blur: { label: 'Blur', icon: Eye, description: 'Blurs their gMatch view until they dismiss it. Never other apps.', consent: 'allowBlurEverything' },
  camera: { label: 'Photo request', icon: Camera, description: 'Asks their camera for one photo. They approve every request.', consent: 'allowRemoteCamera' },
};

const ACTION_ORDER = Object.keys(ACTION_LABELS);

/** In-panel subtab ids: Send | My consent | History | Hacks. */
export const DOMINATION_SUBTABS = ['send', 'consent', 'history', 'hacks'] as const;
export type DominationSubtab = (typeof DOMINATION_SUBTABS)[number];

/** Local persistence for mesh outbox rows (sealed sends skip the server). */
const MESH_OUTBOX_KEY = 'gmatch.domination.meshOutbox.v1';

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
  { key: 'allowDesktopBackgroundChange', label: 'Wallpaper', desc: 'Others may replace your gMatch background.' },
  { key: 'allowDesktopWallpaperOS', label: 'OS wallpaper (high impact)', desc: 'A wallpaper effect may also change your REAL Windows desktop wallpaper for a while, then restore it. Needs Wallpaper on, off by default.' },
  { key: 'allowGameBackgroundChange', label: 'Game background', desc: 'Others may cover the app behind you.' },
  { key: 'allowPopupVideo', label: 'Video popup', desc: 'A muted, dismissible clip may appear in the app.' },
  { key: 'allowPopupMessage', label: 'Message', desc: 'A short note may pop in the app and as an OS toast.' },
  { key: 'allowTextOverlay', label: 'Banner text', desc: 'Large text may sit over your app (plus an OS toast).' },
  { key: 'allowBlurEverything', label: 'Blur', desc: 'The gMatch window may blur for a moment. Never other apps or your desktop.' },
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

export function PCDominationTab({ identity, allUsers, profilePics, points, toast: toastFn, activeHack, setActiveHack, onOpenFlash, mesh }: Props) {
  const { settings, update } = useSettings();
  const [targets, setTargets] = useState<DominationTarget[]>([]);
  const [targetsState, setTargetsState] = useState<LoadState>('idle');
  const [selectedTarget, setSelectedTarget] = useState<DominationTarget | null>(null);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<any[]>([]);
  const [outgoing, setOutgoing] = useState<any[]>([]);
  // Mesh outbox (Fase 5/6): sealed sends never touch the server, so their
  // entries live here — merged into the Outbox list below, flipped by the
  // receipt event the courier hook dispatches (landed | declined | completed
  // | failed | expired). Persisted (capped) so a restart keeps the history.
  const [meshOutgoing, setMeshOutgoing] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem(MESH_OUTBOX_KEY) || '[]') as any[]; } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(MESH_OUTBOX_KEY, JSON.stringify(meshOutgoing.slice(0, 100))); } catch { /* private mode */ }
  }, [meshOutgoing]);
  useEffect(() => {
    const onReceipt = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: string; status?: string }>).detail;
      if (!detail?.id) return;
      setMeshOutgoing((prev) =>
        prev.map((m) => (m.id === detail.id ? { ...m, status: detail.status } : m)),
      );
    };
    window.addEventListener('gmatch:domination-receipt', onReceipt);
    return () => window.removeEventListener('gmatch:domination-receipt', onReceipt);
  }, []);
  const [historyState, setHistoryState] = useState<LoadState>('idle');
  const [historyPane, setHistoryPane] = useState<'incoming' | 'outgoing'>('outgoing');
  const [actionModal, setActionModal] = useState<{ action: string; title: string } | null>(null);
  const [subtab, setSubtab] = useState<DominationSubtab>('send');

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
    const label = ACTION_LABELS[action]?.label || action;
    const consentKey = ACTION_LABELS[action]?.consent;
    const consented = consentKey ? Boolean(selectedTarget.consents?.[consentKey]) : false;
    // Mesh-first (Fase 5/6): peer mesh-addressable + consented => sealed
    // courier send, free, no server in the path. Anything else (unknown
    // keys, mesh throw) falls through to the server trigger route below.
    if (mesh && mesh.peerKnown(selectedTarget.id) && consented) {
      try {
        const r = await mesh.send(selectedTarget.id, action, payload, ownDisplayName() || undefined);
        if (r.ok) {
          setMeshOutgoing((prev) => [
            {
              id: r.id,
              action,
              payload,
              victim_name: selectedTarget.displayName,
              created_at: new Date().toISOString(),
              status: 'sent',
              mesh: true,
            },
            ...prev,
          ]);
          toastFn(`${label} sent to ${selectedTarget.displayName} — free via mesh. Receipt shows in Outbox.`, 'success');
          setSending(null);
          return;
        }
      } catch {
        // Mesh throw => server fallback below (same honest outcome as the
        // server path's own connection-drop handling).
      }
    }
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
          toastFn(`${selectedTarget.displayName} just went offline. Nothing was charged. Pick someone online.`, 'warning');
          void loadTargets();
        } else if (res.status === 403) {
          toastFn(msg || `${selectedTarget.displayName} has that effect turned off.`, 'warning');
        } else if (res.status === 429) {
          toastFn(msg || 'Slow down. That one was just sent.', 'warning');
        } else {
          toastFn(msg || `Could not send ${label}.`, 'error');
        }
      }
    } catch {
      // We do NOT know if the server processed it. Blind retry could double
      // charge — point the user at the authoritative Outbox instead.
      toastFn('Connection dropped before the server answered. Check Outbox before sending again. You may already have been charged.', 'warning');
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

  // One stated fact for every card: a mesh-known target costs nothing. Cards
  // carry only their own exception, never a second copy of this line.
  const allFree = Boolean(selectedTarget && mesh && mesh.peerKnown(selectedTarget.id));

  // Server outbox + local mesh outbox, newest first. Mesh entries never come
  // from the server history fetch, so they merge here at render.
  const outgoingAll = useMemo(
    () =>
      [...meshOutgoing, ...outgoing].sort(
        (a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0),
      ),
    [meshOutgoing, outgoing],
  );

  // ── unauthenticated shell ─────────────────────────────────────────────
  if (!identity) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-3 py-6 font-sans select-none sm:px-6">
        <PageHeader title="PC Domination" meta="Send effects, manage consent, and run hacks." />
        <Card>
          <FeedbackState state="empty" compact title="Log in to use Domination." />
        </Card>
      </div>
    );
  }

  const statusChip = (t: DominationTarget) => {
    if (!t.enabled) return { text: 'blocked', cls: 'text-retro-muted border-edge' };
    if (t.online) return { text: 'online', cls: 'text-success-fg border-success/30' };
    return { text: `seen ${timeAgo(t.last_seen)}`, cls: 'text-warning-fg/80 border-warning/20' };
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-3 py-6 font-sans select-none sm:px-6">
      {/* ONE title at the top of the scale; the receiving state is its only action. */}
      <PageHeader
        title="PC Domination"
        meta="Send effects, manage consent, and run hacks."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg glass-panel px-3 py-2">
            <Radio
              className={cn('size-3.5', receiving && !paused ? STATUS.success : COLOR.muted)}
              aria-hidden="true"
            />
            <span className={cn(TYPE.body, WEIGHT.medium)}>
              {receiving ? (paused ? 'Receiving (paused)' : 'Receiving') : 'Not receiving'}
            </span>
            <Switch
              checked={receiving}
              label="Receive domination effects"
              onChange={() => handleUpdateMaster(!receiving)}
            />
            {receiving && (
              <Button
                variant="ghost"
                size="sm"
                onClick={togglePause}
                className={paused ? STATUS.success : COLOR.muted}
              >
                {paused ? 'Resume' : 'Pause 15m'}
              </Button>
            )}
          </div>
        }
      />
      <Card className="overflow-hidden">
      <div className="border-b border-edge-subtle px-4 py-2.5">
        <Tabs
          tabs={DOMINATION_SUBTABS.map((id) => ({
            id,
            label: id === 'send' ? 'Send' : id === 'consent' ? 'My consent' : id === 'history' ? 'History' : 'Hacks',
          }))}
          value={subtab}
          onChange={setSubtab}
        />
      </div>

      <div className="p-4">
      {subtab === 'send' && (
      <section aria-label="Send">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Targets: one list, one status chip per row, equal padding. */}
          <Card className="flex flex-col overflow-hidden lg:col-span-2" tone="raised">
            <CardHeader
              title="Targets"
              caption={`${onlineCount} online`}
              icon={<Target className="size-3.5" aria-hidden="true" />}
              right={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Refresh targets"
                  onClick={() => void loadTargets()}
                >
                  <RefreshCw className={cn('size-3.5', targetsState === 'loading' && 'animate-spin')} />
                </Button>
              }
            />
            <div className="border-b border-edge-subtle p-3">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search players…"
                aria-label="Search players"
              />
            </div>
            <div className="styled-scrollbar max-h-[420px] overflow-y-auto">
              {targetsState === 'loading' && targets.length === 0 && (
                <FeedbackState state="loading" compact title="Loading players…" />
              )}
              {targetsState === 'error' && (
                <FeedbackState
                  state="error"
                  compact
                  icon={<WifiOff className={FEEDBACK.errorIcon} aria-hidden="true" />}
                  title="Couldn't load the player list."
                  action={
                    <Button variant="primary" size="sm" onClick={() => void loadTargets()}>
                      Try again
                    </Button>
                  }
                />
              )}
              {targetsState === 'ready' && filteredTargets.length === 0 && (
                <FeedbackState
                  state="empty"
                  compact
                  icon={<WifiOff className={FEEDBACK.icon} aria-hidden="true" />}
                  title={search ? 'No player matches that name.' : 'Nobody has Domination switched on yet.'}
                  action={!search ? (
                    <Button variant="primary" size="sm" onClick={() => setSubtab('consent')}>
                      Set up my consent
                    </Button>
                  ) : undefined}
                />
              )}
              {filteredTargets.map((t) => {
                const chip = statusChip(t);
                const isSel = selectedTarget?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTarget(t)}
                    className={cn(
                      'flex w-full items-center gap-3 border-b border-edge-subtle px-4 py-3 text-left transition-colors',
                      isSel ? 'glass-nav-active' : 'hover:bg-glass-w10',
                    )}
                  >
                    {t.pfpUrl ? (
                      <img src={resolveMediaUrl(t.pfpUrl)} alt="" className="size-7 rounded-md border border-edge object-cover" />
                    ) : (
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md glass-inset text-xs font-semibold text-retro-fg">
                        {t.displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-retro-fg">{t.displayName}</span>
                      <span className={cn(MONO, TYPE.caption, COLOR.muted)}>{consentCountOf(t)}/7 effects allowed</span>
                    </span>
                    <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-2xs', chip.cls)}>{chip.text}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Effects: every card is the same shape — label, icon, price. */}
          <div className="space-y-3 lg:col-span-3">
            {!selectedTarget ? (
              <FeedbackState
                state="empty"
                icon={<Target className={FEEDBACK.icon} aria-hidden="true" />}
                title="Pick a target on the left to start."
                className="rounded-lg border border-dashed border-edge"
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg glass-panel px-4 py-2.5">
                  <Title>
                    Effects for <span className="font-semibold">{selectedTarget.displayName}</span>
                  </Title>
                  <span className={cn(MONO, TYPE.body, COLOR.muted)}>{formatCount(points)} g$</span>
                </div>
                {selectedTarget.enabled && !selectedTarget.online && (
                  <Caption className="text-warning-fg/80 text-pretty">
                    They are offline. Sends will be refused and nothing will be charged.
                  </Caption>
                )}
                {(() => {
                  // A state shared by every card is stated once here; the cards then
                  // carry only the exception.
                  const allowedCount = ACTION_ORDER.filter(
                    (a) => Boolean(selectedTarget.consents?.[ACTION_LABELS[a].consent]),
                  ).length
                  const allAllowed = allowedCount === ACTION_ORDER.length
                  const noneAllowed = allowedCount === 0
                  // Free is stated ON every card; do not say it twice here.
                  if (allAllowed || allFree) return null
                  return (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-retro-muted">
                      {noneAllowed && <span>No consent yet — ask in the Consent tab.</span>}
                      {!noneAllowed && <span>Some effects are not consented.</span>}
                    </div>
                  )
                })()}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {ACTION_ORDER.map((action) => {
                    const { label, icon: Icon, consent } = ACTION_LABELS[action];
                    const allowed = Boolean(selectedTarget.consents?.[consent]);
                    const sendable = allowed && Boolean(selectedTarget.enabled) && selectedTarget.online !== false;
                    const priceText = allFree
                      ? 'Free via mesh'
                      : prices[action] != null
                        ? `${prices[action]} g$`
                        : 'Price unavailable';
                    const exceptionText = sending === action ? 'sending…' : !allowed ? 'no consent' : null;
                    return (
                      <button
                        key={action}
                        type="button"
                        onClick={() => setActionModal({ action, title: label })}
                        disabled={!sendable || sending === action}
                        title={
                          !selectedTarget.enabled ? 'They have Domination switched off'
                            : !selectedTarget.online ? 'They are offline. Nothing would be charged'
                              : !allowed ? `They have "${label}" turned off in their consent`
                                : undefined
                        }
                        className={cn(
                          BUTTON_CONTRACT,
                          'flex min-h-24 w-full flex-col items-stretch justify-start gap-3 border p-4 text-left',
                          COLOR.surfaceRaised,
                          sending === action
                            ? 'cursor-wait border-retro-accent'
                            : sendable
                              ? 'border-edge hover:border-retro-accent/60'
                              : 'border-edge-subtle',
                        )}
                      >
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-retro-fg">{label}</span>
                          <Icon className="size-4 shrink-0 text-retro-muted" aria-hidden="true" />
                        </span>
                        <span className="mt-auto flex w-full items-center justify-between gap-2">
                          <span className={cn(MONO, TYPE.caption, allFree ? STATUS.success : COLOR.muted)}>{priceText}</span>
                          {exceptionText && (
                            <span className={cn('font-mono text-2xs', allowed ? STATUS.success : STATUS.danger)}>
                              {exceptionText}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
      )}

      {subtab === 'consent' && (
      <section id="pc-dom-consent" aria-label="My consent">
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <Title className="flex items-center gap-1.5">
              <Zap className="size-3.5 text-retro-muted" aria-hidden="true" /> Preset
            </Title>
            <Caption className="text-pretty">
              One-tap starting points for the switches below. Your public-photo setting is never touched.
            </Caption>
            <div className="flex flex-wrap gap-2">
              {(['mild', 'medium', 'extreme'] as const).map((preset) => (
                <Button
                  key={preset}
                  variant={settings.dominationIntensity === preset ? 'primary' : 'secondary'}
                  size="sm"
                  className="capitalize"
                  onClick={() => applyIntensityPreset(preset)}
                >
                  {preset}
                </Button>
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="What others may send you"
              icon={<Shield className="size-3.5" aria-hidden="true" />}
              caption={!receiving ? 'Saved. Inactive while Receiving is off.' : undefined}
            />
            <div className="divide-y divide-edge-subtle">
              {CONSENT_ROWS.map(({ key, label }) => {
                const value = Boolean((settings as any)[key]);
                return (
                  <div key={key} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-glass-w10">
                    <Switch
                      checked={value}
                      label={label}
                      onChange={() => handleUpdateConsent(key, !value)}
                    />
                    <span className={cn(TYPE.body, WEIGHT.medium, COLOR.fg)}>{label}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </section>
      )}

      {subtab === 'history' && (
      <section aria-label="History">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Tabs
              tabs={[
                { id: 'outgoing' as const, label: 'Sent by you' },
                { id: 'incoming' as const, label: 'Received' },
              ]}
              value={historyPane}
              onChange={setHistoryPane}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadHistory()}
              disabled={historyState === 'loading'}
            >
              <RefreshCw className={cn('size-3.5', historyState === 'loading' && 'animate-spin')} />
              Refresh
            </Button>
          </div>

          {historyState === 'loading' && history.length === 0 && outgoing.length === 0 && (
            <FeedbackState state="loading" title="Loading…" />
          )}
          {historyState === 'error' && (
            <FeedbackState
              state="error"
              title="Couldn't load history."
              action={
                <Button variant="primary" size="sm" onClick={() => void loadHistory()}>
                  Try again
                </Button>
              }
            />
          )}
          {historyState === 'ready' && (historyPane === 'outgoing' ? outgoingAll : history).length === 0 && (
            <FeedbackState
              state="empty"
              icon={<Inbox className={FEEDBACK.icon} aria-hidden="true" />}
              title={historyPane === 'outgoing' ? 'You have not sent anything yet.' : 'Nothing has landed on your screen yet.'}
              className="rounded-lg border border-dashed border-edge"
            />
          )}
          <div className="space-y-2">
            {(historyPane === 'outgoing' ? outgoingAll : history).map((action: any) => {
              const meta = ACTION_LABELS[action.action];
              const Icon = meta?.icon || Monitor;
              const st: string = action.status || 'sent';
              const summary = payloadSummary(action.action, typeof action.payload === 'string' ? (() => { try { return JSON.parse(action.payload); } catch { return null; } })() : action.payload);
              const other = historyPane === 'outgoing' ? action.victim_name : action.dominator_name;
              return (
                <div key={action.id} className={cn(CHROME.rowTile, 'gap-3 px-4 py-3')}>
                  <Icon className="size-4 shrink-0 text-retro-muted" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-retro-fg">
                      {meta?.label || action.action}
                      {summary && <span className="font-normal text-retro-muted">. {summary}</span>}
                    </div>
                    <div className={cn(MONO, TYPE.caption, COLOR.muted, 'truncate')}>
                      {historyPane === 'outgoing' ? `to ${other || 'unknown'}` : `from ${other || 'unknown'}`}
                      {' · '}{formatAbsoluteTime(action.created_at, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-2xs',
                      st === 'executed' || st === 'completed'
                        ? 'border-success/30 text-success-fg'
                        : st === 'sent' || st === 'landed'
                          ? 'border-edge text-retro-muted'
                          : st === 'expired'
                            ? 'border-warning/30 text-warning-fg'
                            : 'border-danger/30 text-danger-fg',
                    )}
                    title={
                      st === 'sent' ? 'Accepted by the server, waiting for their screen to confirm'
                        : st === 'landed' ? 'Reached their screen (consented); execution still pending'
                          : st === 'executed' || st === 'completed' ? 'Confirmed executed on their device'
                            : st === 'failed' ? 'Their client tried and the effect failed (OS refused, media unreachable, or capture declined)'
                              : st === 'expired' ? 'Their client never confirmed it rendered (app closed or camera blocked). Their consent cut stayed paid.'
                                : st
                    }
                  >
                    {st === 'executed' || st === 'completed'
                      ? 'landed'
                      : st === 'landed'
                        ? 'delivered'
                        : st === 'sent'
                          ? (historyPane === 'outgoing' ? 'awaiting' : 'received')
                          : st === 'expired'
                            ? (historyPane === 'outgoing' ? 'fizzled' : 'skipped')
                            : st}
                  </span>
                </div>
              );
            })}
          </div>
          {historyPane === 'outgoing' && historyState === 'ready' && outgoingAll.length > 0 && (
            <p className="px-1 text-xs text-retro-muted text-pretty">
              <span className="font-mono">awaiting</span> = charged and relayed; it flips to{' '}
              <span className="font-mono text-success-fg/80">landed</span> once their client confirms, or to{' '}
              <span className="font-mono text-warning-fg/80">fizzled</span> after 30 min if it never rendered.
              Camera requests stay <span className="font-mono">awaiting</span> until they approve the photo.
            </p>
          )}
        </div>
      </section>
      )}

      {subtab === 'hacks' && (
      <section aria-label="Hacks">
        <HacksPanel
          identity={identity}
          users={allUsers}
          profilePics={profilePics}
          points={points}
          toast={toastFn}
          activeHack={activeHack}
          setActiveHack={setActiveHack}
          onOpenFlash={onOpenFlash}
          onExitSpy={() => setSubtab('send')}
        />
      </section>
      )}

      </div>
      </Card>

      {actionModal && (
        <ActionModal
          action={actionModal.action}
          actionTitle={actionModal.title}
          targetName={selectedTarget?.displayName}
          price={prices[actionModal.action]}
          freeViaMesh={allFree}
          isOpen={Boolean(actionModal)}
          onClose={() => setActionModal(null)}
          onSubmit={handleModalSubmit}
          loading={Boolean(sending)}
        />
      )}
    </div>
  );
}
