"use client";

import { useState, useCallback, useEffect } from 'react';
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
  CheckCircle2,
  Settings as SettingsIcon,
  Send,
  Loader2,
  UserCheck,
  Radio,
  History,
} from 'lucide-react';
import { orbitFetch } from '../../utils/api';
import { useSettings } from '../../hooks/useSettings';
import type { OrbitIdentity } from '@orbit/crypto';
import { ActionModal } from './ActionModal';

interface Props {
  identity: OrbitIdentity | null;
  users: Array<{ id: string; orbitId: string; display_name: string; pfp_url?: string }>;
}

interface DominationTarget {
  id: string;
  displayName: string;
  pfpUrl?: string;
  enabled: boolean;
  consents?: Record<string, boolean>;
}

const ACTION_LABELS: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; description: string }> = {
  wallpaper: { label: 'Desktop Wallpaper', icon: Paintbrush, description: 'Change victim\'s desktop background' },
  game_bg: { label: 'Game Background', icon: Gamepad2, description: 'Override game canvas background' },
  popup_video: { label: 'Popup Video', icon: Volume2, description: 'Force-play fullscreen video popup' },
  message: { label: 'Popup Message', icon: AlertTriangle, description: 'Display a custom message overlay' },
  text_overlay: { label: 'Text Overlay', icon: Layers, description: 'Render glowing text on victim\'s screen' },
  blur: { label: 'Blur Everything', icon: Eye, description: 'Apply blur filter to victim\'s app' },
  camera: { label: 'Remote Camera', icon: Camera, description: 'Request snapshot from victim\'s camera' },
} as const;

export const INTENSITY_PRESETS: Record<string, Record<string, boolean>> = {
  mild: {
    allowDesktopBackgroundChange: true,
    allowGameBackgroundChange: false,
    allowPopupVideo: false,
    allowPopupMessage: true,
    allowTextOverlay: true,
    allowBlurEverything: false,
    allowRemoteCamera: false,
  },
  medium: {
    allowDesktopBackgroundChange: true,
    allowGameBackgroundChange: true,
    allowPopupVideo: true,
    allowPopupMessage: true,
    allowTextOverlay: true,
    allowBlurEverything: true,
    allowRemoteCamera: false,
  },
  extreme: {
    allowDesktopBackgroundChange: true,
    allowGameBackgroundChange: true,
    allowPopupVideo: true,
    allowPopupMessage: true,
    allowTextOverlay: true,
    allowBlurEverything: true,
    allowRemoteCamera: true,
  },
};

export function PCDominationTab({ identity, users }: Props) {
  const { settings, update } = useSettings();
  const [activeTab, setActiveTab] = useState<'consent' | 'control' | 'history'>('control');
  const [targets, setTargets] = useState<DominationTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<DominationTarget | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [actionModal, setActionModal] = useState<{ action: string; title: string } | null>(null);

  const syncSettingsToServer = useCallback(async (enabled: boolean, consentMap: Record<string, any>) => {
    if (!identity) return;
    try {
      await orbitFetch('/api/domination/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          settings: consentMap,
        }),
      }, identity);
    } catch {}
  }, [identity]);

  const loadServerTargets = useCallback(async () => {
    if (!identity) return;
    try {
      const [targetsRes, settingsRes] = await Promise.all([
        orbitFetch('/api/domination/targets', {}, identity),
        orbitFetch('/api/domination/settings', {}, identity),
      ]);
      orbitFetch('/api/domination/prices', {}, identity).then(async (r) => {
        if (r.ok) { const d = await r.json(); if (d?.prices) setPrices(d.prices) }
      }).catch(() => {});
      if (targetsRes.ok) {
        const data = await targetsRes.json();
        const list = Array.isArray(data.targets) ? data.targets : [];
        setTargets(list);
        if (list.length > 0) {
          setSelectedTarget((prev) => {
            if (!prev) return list[0];
            const updated = list.find((t: DominationTarget) => t.id === prev.id);
            return updated || list[0];
          });
        }
      }
      if (settingsRes.ok) {
        const serverConfig = await settingsRes.json();
        if (typeof serverConfig?.enabled === 'boolean' && serverConfig.enabled !== settings.pcDominationEnabled) {
          update('pcDominationEnabled', serverConfig.enabled);
        }
      }
    } catch {}
  }, [identity, settings.pcDominationEnabled, update]);

  useEffect(() => {
    loadServerTargets();
  }, [loadServerTargets]);

  const handleUpdateConsent = (key: string, value: boolean) => {
    update(key as any, value);
    const updatedSettings = {
      allowDesktopBackgroundChange: key === 'allowDesktopBackgroundChange' ? value : settings.allowDesktopBackgroundChange,
      allowGameBackgroundChange: key === 'allowGameBackgroundChange' ? value : settings.allowGameBackgroundChange,
      allowPopupVideo: key === 'allowPopupVideo' ? value : settings.allowPopupVideo,
      allowPopupMessage: key === 'allowPopupMessage' ? value : settings.allowPopupMessage,
      allowTextOverlay: key === 'allowTextOverlay' ? value : settings.allowTextOverlay,
      allowBlurEverything: key === 'allowBlurEverything' ? value : settings.allowBlurEverything,
      allowRemoteCamera: key === 'allowRemoteCamera' ? value : settings.allowRemoteCamera,
      allowPublicCamera: key === 'allowPublicCamera' ? value : settings.allowPublicCamera,
    };
    void syncSettingsToServer(settings.pcDominationEnabled, updatedSettings);
  };

  const handleUpdateMaster = (enabled: boolean) => {
    update('pcDominationEnabled', enabled);
    const currentConsents = {
      allowDesktopBackgroundChange: settings.allowDesktopBackgroundChange,
      allowGameBackgroundChange: settings.allowGameBackgroundChange,
      allowPopupVideo: settings.allowPopupVideo,
      allowPopupMessage: settings.allowPopupMessage,
      allowTextOverlay: settings.allowTextOverlay,
      allowBlurEverything: settings.allowBlurEverything,
      allowRemoteCamera: settings.allowRemoteCamera,
      allowPublicCamera: settings.allowPublicCamera,
    };
    void syncSettingsToServer(enabled, currentConsents);
  };

  const loadHistory = useCallback(async () => {
    if (!identity) return;
    setLoadingHistory(true);
    try {
      const res = await orbitFetch('/api/domination/history?limit=100', {}, identity);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.actions || []);
      }
    } catch {}
    setLoadingHistory(false);
  }, [identity]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab, loadHistory]);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const applyIntensityPreset = (preset: 'mild' | 'medium' | 'extreme') => {
    const newSettings = INTENSITY_PRESETS[preset];
    Object.entries(newSettings).forEach(([key, value]) => {
      update(key as any, value);
    });
    update('dominationIntensity', preset);
    void syncSettingsToServer(settings.pcDominationEnabled, newSettings);
    showToast('success', `Applied ${preset} intensity preset`);
  };

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
      if (res.ok) {
        const data = await res.json().catch(() => ({} as any));
        const cost = typeof data?.cost === 'number' ? data.cost : prices[action];
        const payout = typeof data?.victimReward === 'number' ? data.victimReward : 0;
        // When neither the response nor /prices gave a number, drop the cost
        // clause rather than render '-undefined g$'.
        const money =
          typeof cost === 'number' && payout > 0
            ? ` — -${cost} g$ (target earned +${payout} g$)`
            : typeof cost === 'number'
              ? ` — -${cost} g$`
              : '';
        showToast('success', `${ACTION_LABELS[action]?.label || action} sent to ${selectedTarget.displayName}${money}`);
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        showToast('error', err.error || 'Failed to send action');
      }
    } catch {
      showToast('error', 'Network error');
    } finally {
      setSending(null);
    }
  };

  const handleOpenActionModal = (action: string) => {
    const meta = ACTION_LABELS[action];
    setActionModal({ action, title: meta?.label || action });
  };

  const handleModalSubmit = async (payload: any) => {
    if (!actionModal) return;
    await sendAction(actionModal.action, payload);
    setActionModal(null);
  };

  if (!identity) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-12 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-3xl glass-panel border border-border-glass flex items-center justify-center mb-4 text-purple-400">
          <Monitor className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-black text-retro-fg uppercase tracking-wider mb-2">PC Domination</h2>
        <p className="text-xs text-retro-muted max-w-md leading-relaxed">
          Log in to access PC Domination controls. Enable the feature in consent settings, then select a target to send commands.
        </p>
      </div>
    );
  }

  const consentSettings = [
    { key: 'allowDesktopBackgroundChange', label: 'Desktop Background', desc: 'Allow changing desktop wallpaper' },
    { key: 'allowGameBackgroundChange', label: 'Game Background', desc: 'Allow overriding in-game canvas background' },
    { key: 'allowPopupVideo', label: 'Popup Videos', desc: 'Allow forced video popup playback' },
    { key: 'allowPopupMessage', label: 'Popup Messages', desc: 'Allow message overlays on screen' },
    { key: 'allowTextOverlay', label: 'Text Overlays', desc: 'Allow glowing text HUD on screen' },
    { key: 'allowBlurEverything', label: 'Blur Effects', desc: 'Allow blurring the entire view' },
    { key: 'allowRemoteCamera', label: 'Remote Camera', desc: 'Allow camera snapshot requests' },
    { key: 'allowPublicCamera', label: 'Public Camera Uploads', desc: 'Allow camera snapshots to be public (otherwise private to dominator)' },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6 flex flex-col gap-4 font-sans select-none text-retro-fg pb-24 lg:pb-16 animate-orbit-fade-in">
      {/* Centered Master Glass Container */}
      <div className="module module-primary module-glass glass-surface rounded-3xl overflow-hidden border border-border-glass shadow-2xl flex flex-col">
        {/* Header Bar with Gradient Accent */}
        <div className="p-4 sm:p-6 border-b border-border-glass flex flex-wrap items-center justify-between gap-4 bg-surface-canvas/40 backdrop-blur-md">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-purple-500/20 via-indigo-500/20 to-purple-600/30 border border-purple-500/30 flex items-center justify-center shadow-md">
              <Monitor className="w-5 h-5 text-purple-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black tracking-tight text-retro-fg">PC DOMINATION</h1>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/30">
                  SUITE
                </span>
              </div>
              <p className="text-xs text-retro-muted">Remote visual &amp; audio effects for consenting partners</p>
            </div>
          </div>

          {/* Master Enable Switch */}
          <div className="flex items-center gap-3 p-1.5 px-3.5 rounded-2xl glass-panel border border-border-glass bg-surface-interactive/60">
            <label className="flex items-center gap-2.5 text-xs font-bold cursor-pointer text-retro-fg">
              <input
                type="checkbox"
                checked={settings.pcDominationEnabled}
                onChange={(e) => handleUpdateMaster(e.target.checked)}
                className="w-4 h-4 accent-purple-500 rounded cursor-pointer"
              />
              <span>Master Enabled</span>
            </label>
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                settings.pcDominationEnabled ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-zinc-600'
              }`}
            />
          </div>
        </div>

        {/* Tab Selection Navigation */}
        <div className="flex items-center gap-2 px-4 sm:px-6 py-2.5 border-b border-border-glass bg-surface-raised/40 overflow-x-auto styled-scrollbar">
          {[
            { id: 'control', label: 'Send Commands', icon: Send },
            { id: 'consent', label: 'Consent & Presets', icon: Shield },
            { id: 'history', label: 'Action History', icon: History },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`glass-tab px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                  isActive ? 'glass-tab-active' : ''
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Module Content Body with Generous Gaps */}
        <div className="p-4 sm:p-7 space-y-6">
          {/* TAB 1: SEND COMMANDS */}
          {activeTab === 'control' && (
            <div className="space-y-6">
              {/* Target Selection Card */}
              <div className="glass-panel p-5 rounded-2xl border border-border-glass bg-surface-raised/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-purple-400" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-retro-fg">Select Target</h3>
                  </div>
                  <span className="text-[10px] text-retro-muted font-mono">{targets.length} available</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="block text-[11px] font-bold text-retro-muted mb-1.5">Target Player</label>
                    <select
                      value={selectedTarget?.id || ''}
                      onChange={(e) => {
                        const target = targets.find((t) => t.id === e.target.value);
                        setSelectedTarget(target || null);
                      }}
                      className="w-full bg-surface-interactive border border-border-glass rounded-xl px-3.5 py-2.5 text-xs text-retro-fg outline-none focus:border-retro-accent transition-colors"
                      disabled={targets.length === 0}
                    >
                      <option value="">Select a player...</option>
                      {targets.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.displayName} {t.enabled ? '✓ (Domination On)' : '✗ (Disabled)'}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedTarget ? (
                    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-canvas/60 border border-border-glass">
                      {selectedTarget.pfpUrl ? (
                        <img src={selectedTarget.pfpUrl} alt="" className="w-9 h-9 rounded-full object-cover border border-border-glass" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-surface-interactive flex items-center justify-center text-xs font-black text-retro-fg">
                          {selectedTarget.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-retro-fg truncate">{selectedTarget.displayName}</div>
                        <div className="text-[10px] flex items-center gap-1.5 mt-0.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              selectedTarget.enabled ? 'bg-emerald-400 shadow-xs' : 'bg-zinc-600'
                            }`}
                          />
                          <span className={selectedTarget.enabled ? 'text-emerald-400 font-semibold' : 'text-retro-muted'}>
                            {selectedTarget.enabled ? 'PC Domination Enabled' : 'PC Domination Disabled'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl border border-dashed border-border-glass text-center text-xs text-retro-muted">
                      No target selected
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons Grid */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-retro-fg">Available Actions</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {Object.entries(ACTION_LABELS).map(([action, { label, icon: Icon, description }]) => {
                    const isConsented = Boolean(selectedTarget?.consents?.[`allow${action === 'wallpaper' ? 'DesktopBackgroundChange' : action === 'game_bg' ? 'GameBackgroundChange' : action === 'popup_video' ? 'PopupVideo' : action === 'message' ? 'PopupMessage' : action === 'text_overlay' ? 'TextOverlay' : action === 'blur' ? 'BlurEverything' : 'RemoteCamera'}`]);
                    const canSend = Boolean(selectedTarget && selectedTarget.enabled && settings.pcDominationEnabled);

                    return (
                      <button
                        key={action}
                        type="button"
                        onClick={() => handleOpenActionModal(action)}
                        disabled={!canSend || sending === action}
                        className={`p-4 rounded-2xl border transition-all text-left group relative flex flex-col justify-between min-h-[105px] cursor-pointer ${
                          sending === action
                            ? 'border-purple-500 bg-purple-500/10'
                            : isConsented && canSend
                            ? 'glass-panel border-border-glass hover:border-purple-400/60 hover:shadow-lg hover:translate-y-[-1px]'
                            : 'glass-panel border-border-glass/40 opacity-50 cursor-not-allowed'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="w-7 h-7 rounded-lg bg-surface-interactive flex items-center justify-center text-retro-muted group-hover:text-purple-300 transition-colors">
                              <Icon className="w-4 h-4" />
                            </div>
                            {isConsented ? (
                              <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                                Ready
                              </span>
                            ) : (
                              <span className="text-[9px] font-mono text-retro-muted bg-surface-interactive px-1.5 py-0.5 rounded">
                                No Consent
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-bold text-retro-fg leading-tight">{label}</div>
                          <div className="text-[10px] text-retro-muted mt-1 leading-snug">{description}</div>
                          {prices[action] != null && (
                            <div className="text-[10px] font-mono font-bold text-amber-300 mt-1.5">{prices[action]} g$</div>
                          )}
                        </div>

                        {sending === action && (
                          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs rounded-2xl flex items-center justify-center">
                            <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Target Consent Inspection */}
              {selectedTarget && (
                <div className="glass-panel p-5 rounded-2xl border border-border-glass bg-surface-canvas/40 space-y-3">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-xs font-black uppercase tracking-wider text-retro-fg">
                      {selectedTarget.displayName}&apos;s Live Permissions
                    </h4>
                  </div>
                  <p className="text-[11px] text-retro-muted leading-relaxed">
                    Actions require the target player to have explicit consent enabled in their settings.
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    {consentSettings.map(({ key, label }) => {
                      const hasConsent = Boolean(selectedTarget.consents?.[key]);
                      return (
                        <div
                          key={key}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] border font-medium ${
                            hasConsent
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                              : 'bg-surface-interactive border-border-glass text-retro-muted opacity-60'
                          }`}
                        >
                          <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${hasConsent ? 'text-emerald-400' : 'text-zinc-600'}`} />
                          <span className="truncate">{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CONSENT & PRESETS */}
          {activeTab === 'consent' && (
            <div className="space-y-6">
              {/* Intensity Presets Card */}
              <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-border-glass bg-surface-raised/40 space-y-4">
                <div className="flex items-center gap-2">
                  <SettingsIcon className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-retro-fg">Intensity Bundles</h3>
                </div>
                <p className="text-xs text-retro-muted leading-relaxed">
                  Quick-apply consent profiles. Higher intensity unlocks more intrusive and powerful features.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {(['mild', 'medium', 'extreme'] as const).map((preset) => {
                    const isSelected = settings.dominationIntensity === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => applyIntensityPreset(preset)}
                        disabled={!settings.pcDominationEnabled}
                        className={`p-4 rounded-2xl border transition-all text-left cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'border-purple-400 bg-purple-500/15 shadow-md'
                            : 'glass-panel border-border-glass hover:border-retro-fg/40 disabled:opacity-40'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-black uppercase tracking-wider text-retro-fg">{preset}</span>
                            {isSelected && (
                              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-purple-400 text-black">
                                ACTIVE
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-retro-muted leading-snug">
                            {preset === 'mild' && 'Wallpaper, messages, text overlays only.'}
                            {preset === 'medium' && 'Wallpaper, game canvas, video popup, blur, messages.'}
                            {preset === 'extreme' && 'All effects including full remote camera snapshot.'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Granular Consent Checkboxes */}
              <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-border-glass bg-surface-raised/40 space-y-4">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-retro-fg">My Inbound Consents</h3>
                </div>
                <p className="text-xs text-retro-muted leading-relaxed">
                  Toggle granular permissions for actions other trusted players can perform on your screen.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {consentSettings.map(({ key, label, desc }) => {
                    const value = Boolean(settings[key as keyof typeof settings]);
                    return (
                      <label
                        key={key}
                        className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all cursor-pointer ${
                          value && settings.pcDominationEnabled
                            ? 'bg-purple-500/10 border-purple-500/30'
                            : 'bg-surface-interactive/60 border-border-glass'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={value}
                          onChange={(e) => handleUpdateConsent(key, e.target.checked)}
                          disabled={!settings.pcDominationEnabled}
                          className="mt-1 w-4 h-4 accent-purple-500 rounded cursor-pointer shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-retro-fg">{label}</div>
                          <div className="text-[11px] text-retro-muted leading-tight mt-0.5">{desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ACTION HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-retro-fg">Recent Actions</h3>
                </div>
                <button
                  type="button"
                  onClick={loadHistory}
                  disabled={loadingHistory}
                  className="px-3 py-1.5 text-xs font-bold text-retro-fg bg-surface-interactive border border-border-glass rounded-xl hover:bg-surface-raised transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Loader2 className={`w-3 h-3 ${loadingHistory ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {history.length === 0 ? (
                <div className="text-center py-12 glass-panel border border-border-glass rounded-2xl space-y-2">
                  <Monitor className="w-8 h-8 mx-auto text-retro-muted opacity-40" />
                  <p className="text-xs font-bold text-retro-muted">No domination actions recorded yet</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {history.map((action: any) => {
                    const actionMeta = ACTION_LABELS[action.action];
                    const Icon = actionMeta?.icon || Monitor;
                    return (
                      <div key={action.id} className="glass-panel p-4 rounded-2xl border border-border-glass bg-surface-raised/40 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-retro-fg capitalize truncate">
                                {actionMeta?.label || action.action}
                              </div>
                              <div className="text-[10px] text-retro-muted truncate">
                                {action.dominator_name ? `From ${action.dominator_name}` : 'Triggered'}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                                action.status === 'executed' || action.status === 'sent'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : action.status === 'denied'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}
                            >
                              {action.status}
                            </span>
                            <div className="text-[9px] font-mono text-retro-muted mt-1">
                              {new Date(action.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>

                        {action.payload && (
                          <div className="p-2.5 bg-black/40 border border-border-glass rounded-xl text-[10px] font-mono text-retro-muted overflow-x-auto">
                            {JSON.stringify(action.payload)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl shadow-2xl animate-orbit-slide-up text-xs font-bold border flex items-center gap-2 ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/50'
              : toast.type === 'error'
              ? 'bg-rose-950/90 text-rose-200 border-rose-500/50'
              : 'bg-surface-raised/95 text-retro-fg border-border-glass'
          }`}
        >
          {toast.message}
        </div>
      )}

      {actionModal && (
        <ActionModal
          action={actionModal.action}
          actionTitle={actionModal.title}
          isOpen={Boolean(actionModal)}
          onClose={() => setActionModal(null)}
          onSubmit={handleModalSubmit}
          loading={Boolean(sending)}
        />
      )}
    </div>
  );
}
