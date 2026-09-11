"use client";
import { Switch } from '../../ui/Switch'

import React, { useState, useEffect } from 'react';
import type { AppSettings } from '../../hooks/useSettings';
import type { OrbitIdentity } from '@orbit/crypto';
import { playPress, playMsgReceive } from '../../utils/sounds';
import { useGame, MAX_USER_EXCLUDES } from '../../game/store';
import { FeedTuneStep } from '../../firstRun/FeedTuneStep';
import { ServerTab } from './ServerTab';
import { DeleteAccountSection } from './DeleteAccountSection';
import { UpdateSection } from './UpdateSection';
import {
  Settings,
  User,
  Shield,
  Image,
  X,
  Check,
  Copy,
  Download,
  LogIn,
  LogOut,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Upload,
  Rss,
  Server,
} from 'lucide-react';

export type SettingsTabId =
  | 'preferences'
  | 'account'
  | 'feed'
  | 'wallpaper'
  | 'server';

interface GMatchSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  identity: OrbitIdentity | null;
  onOpenIdentityModal?: (mode: 'export' | 'login' | 'logout') => void;
  /** Called after the account + every local trace is deleted — shell logs out. */
  onAccountDeleted?: () => void;
  toast?: (msg: string, type?: 'error' | 'success' | 'info' | 'warning' | any) => void;
  initialTab?: SettingsTabId;
}

const WALLPAPER_PRESETS = [
  { id: 'default', name: 'Default Minimal', url: '' },
  { id: 'grid', name: 'Cyber Grid Neon', url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1920&q=80' },
  { id: 'space', name: 'Deep Space Orbit', url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1920&q=80' },
  { id: 'minimal', name: 'Studio Gradient', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1920&q=80' },
];

function FeedSettingsTab({ toast }: { toast?: (msg: string, type?: string) => void }) {
  const tags = useGame((s) => s.tags);
  const userExcludes = useGame((s) => s.userExcludes);
  const addUserExclude = useGame((s) => s.addUserExclude);
  const removeUserExclude = useGame((s) => s.removeUserExclude);
  const [draft, setDraft] = useState('');
  const [showPicksEditor, setShowPicksEditor] = useState(false);
  const owned = tags.filter((t) => t.level === 0 && t.selected !== false);

  const add = () => {
    const parts = draft
      .split(/[\s,]+/)
      .map((t) => t.toLowerCase().trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    let added = 0;
    for (const p of parts) {
      if (addUserExclude(p)) added += 1;
    }
    toast?.(
      added > 0
        ? `Excluded ${added} term${added === 1 ? '' : 's'}.`
        : 'Nothing added (duplicate, empty, or list full).',
      added > 0 ? 'success' : 'info',
    );
    setDraft('');
  };

  return (
    <div className="space-y-6 animate-orbit-fade-in">
      <div className="p-4 bg-surface-interactive border border-border-glass rounded-lg space-y-3">
        <h4 className="text-xs font-medium text-retro-fg">Starter Picks</h4>
        {owned.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {owned.map((t) => (
              <span
                key={t.name}
                className="inline-flex items-center rounded-full border border-border-glass bg-glass-w5 px-2.5 py-1 text-[11px] font-mono text-retro-fg"
              >
                {t.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-retro-muted">
            No starter tags selected.
          </p>
        )}
        <p className="text-[11px] text-retro-muted">
          Active excluded tags ({userExcludes.length}/{MAX_USER_EXCLUDES}).
        </p>
        {showPicksEditor ? (
          <FeedTuneStep onFinished={() => setShowPicksEditor(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setShowPicksEditor(true)}
            className="px-3 py-1.5 rounded-xl border border-border-glass text-[11px] font-bold text-retro-fg hover:bg-surface-raised cursor-pointer"
          >
            Change starter tags
          </button>
        )}
      </div>

      <div className="p-4 bg-surface-raised border border-border-glass rounded-2xl space-y-3">
        <h4 className="text-xs font-medium text-retro-fg">Excluded Tags</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            placeholder="Add excluded tag"
            aria-label="Add an excluded tag"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            className="flex-1 bg-surface-interactive border border-border-glass rounded-xl px-3 py-2 text-xs text-retro-fg outline-none focus:border-retro-accent placeholder:text-retro-muted/60"
          />
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={add}
            className="px-4 py-2 bg-retro-accent hover:bg-retro-accent-hover disabled:opacity-40 text-black rounded-xl text-xs font-bold cursor-pointer shrink-0"
          >
            Add
          </button>
        </div>
        {userExcludes.length === 0 ? (
          <p className="text-[11px] text-retro-muted">No custom excludes configured.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {userExcludes.map((x) => (
              <span
                key={x}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-glass bg-glass-w5 px-2.5 py-1 text-[11px] font-mono text-retro-fg"
              >
                {x}
                <button
                  type="button"
                  aria-label={`Remove exclude ${x}`}
                  title={`Stop excluding ${x}`}
                  onClick={() => removeUserExclude(x)}
                  className="text-retro-muted hover:text-red-400 cursor-pointer"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function GMatchSettingsModal({
  isOpen,
  onClose,
  settings,
  updateSettings,
  identity,
  onOpenIdentityModal,
  onAccountDeleted,
  toast,
  initialTab = 'preferences',
}: GMatchSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'preferences' | 'account' | 'feed' | 'server'>(() => {
    if (initialTab === 'account' || initialTab === 'feed' || initialTab === 'server') return initialTab as 'account' | 'feed' | 'server';
    return 'preferences';
  });
  const [wallpaperExpanded, setWallpaperExpanded] = useState(() => initialTab === 'wallpaper');
  const [copiedId, setCopiedId] = useState(false);
  const [customWallpaperInput, setCustomWallpaperInput] = useState(settings.wallpaperUrl || '');

  useEffect(() => {
    if (initialTab === 'wallpaper') {
      setActiveTab('preferences');
      setWallpaperExpanded(true);
    } else if (initialTab === 'account' || initialTab === 'feed') {
      setActiveTab(initialTab);
    } else {
      setActiveTab('preferences');
    }
  }, [initialTab]);

  if (!isOpen) return null;

  const handleCopyId = () => {
    if (!identity?.orbitId) return;
    playPress(800);
    navigator.clipboard.writeText(identity.orbitId);
    setCopiedId(true);
    toast?.('Orbit ID copied to clipboard', 'info');
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleWallpaperFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');

    const finish = (url: string, mime: string) => {
      updateSettings('wallpaperUrl', url);
      updateSettings('wallpaperPreset', 'custom-file');
      updateSettings('wallpaperMime', mime);
      updateSettings('wallpaperSlideshow', false);
      setCustomWallpaperInput(file.name);
      toast?.(isVideo ? 'Video wallpaper applied' : 'Custom wallpaper applied', 'success');
      e.target.value = '';
    };

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (isVideo) {
        finish(dataUrl, file.type);
        return;
      }
      const img = new window.Image();
      img.onload = () => {
        const MAX = 1920;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(dataUrl, file.type || 'image/jpeg');
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        finish(canvas.toDataURL('image/jpeg', 0.82), 'image/jpeg');
      };
      img.onerror = () => finish(dataUrl, file.type || 'image/jpeg');
      img.src = dataUrl;
    };
    reader.onerror = () => toast?.('Could not read wallpaper file', 'error');
    reader.readAsDataURL(file);
  };

  const applyCustomWallpaper = () => {
    if (!customWallpaperInput.trim()) {
      updateSettings('wallpaperUrl', '');
      updateSettings('wallpaperPreset', 'default');
      updateSettings('wallpaperMime', '');
      updateSettings('wallpaperSlideshow', false);
      toast?.('Wallpaper reset to default', 'info');
      return;
    }
    const url = customWallpaperInput.trim();
    const isVideo = /\.(mp4|webm|ogv|mov)(\?|$)/i.test(url.split('?')[0]);
    updateSettings('wallpaperUrl', url);
    updateSettings('wallpaperPreset', 'custom');
    updateSettings('wallpaperMime', isVideo ? 'video/mp4' : 'image/jpeg');
    updateSettings('wallpaperSlideshow', false);
    toast?.('Wallpaper URL updated', 'success');
  };

  const clearWallpaper = () => {
    playPress(600);
    updateSettings('wallpaperUrl', '');
    updateSettings('wallpaperPreset', 'default');
    updateSettings('wallpaperMime', '');
    updateSettings('wallpaperSlideshow', false);
    setCustomWallpaperInput('');
    toast?.('Wallpaper reset to default', 'info');
  };

  const navItems: { id: 'preferences' | 'account' | 'feed' | 'server'; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'preferences', label: 'Preferences', icon: Settings },
    { id: 'account', label: 'Account & Security', icon: User },
    { id: 'feed', label: 'Feed & Tags', icon: Rss },
    { id: 'server', label: 'Server', icon: Server },
  ];

  return (
    <div
      className="fixed inset-0 z-[100000] bg-black/75 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 select-none font-sans animate-orbit-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-glass backdrop-blur-2xl text-retro-fg border border-border-glass rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] max-h-[750px] overflow-hidden flex flex-col md:flex-row animate-orbit-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Navigation Sidebar */}
        <div className="w-full md:w-56 border-b md:border-b-0 md:border-r border-border-glass bg-surface-raised flex flex-col shrink-0">
          {/* Header */}
          <div className="p-4 border-b border-border-glass flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-surface-interactive flex items-center justify-center text-retro-muted">
                <Settings className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-medium text-retro-fg">Settings</h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="md:hidden p-1 text-retro-muted hover:text-retro-fg rounded cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <div className="p-2 space-y-0.5 overflow-x-auto md:overflow-y-auto flex md:flex-col gap-1 md:gap-0 styled-scrollbar-none">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    playPress(850);
                    setActiveTab(item.id);
                  }}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-medium transition-colors flex items-center justify-between cursor-pointer whitespace-nowrap ${isActive
                      ? 'bg-surface-interactive text-retro-fg'
                      : 'text-retro-muted hover:text-retro-fg hover:bg-surface-interactive'
                    }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-retro-accent' : ''}`} />
                    <span>{item.label}</span>
                  </div>
                  <ChevronRight className={`hidden md:block w-3.5 h-3.5 ${isActive ? 'text-retro-accent' : ''}`} />
                </button>
              );
            })}
          </div>

          {/* User Profile Mini Footer */}
          <div className="hidden md:flex mt-auto p-3 border-t border-border-glass items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-surface-interactive flex items-center justify-center font-medium text-xs text-retro-muted">
                {identity?.orbitId?.substring(0, 1).toUpperCase() || 'U'}
              </div>
              <div className="min-w-0">
                <span className="text-xs font-medium block truncate">{identity?.orbitId ? `@${identity.orbitId.substring(0, 8)}` : 'Guest'}</span>
                <span className="text-[10px] text-retro-online">Online</span>
              </div>
            </div>
            <span className="text-[10px] font-mono text-retro-muted">v1.0.0</span>
          </div>
        </div>

        {/* Right Main Content Pane */}
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-raised">
          {/* Top Bar */}
          <div className="hidden md:flex items-center justify-between px-5 py-3.5 border-b border-border-glass">
            <h3 className="text-sm font-medium text-retro-fg">
              {navItems.find((n) => n.id === activeTab)?.label}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-retro-muted hover:text-retro-fg rounded hover:bg-surface-interactive transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Settings Panel Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 styled-scrollbar">
            {/* ──────── 1. PREFERENCES ──────── */}
            {activeTab === 'preferences' && (
              <div className="space-y-6 animate-orbit-fade-in">
                {/* Display & Layout */}
                <div className="p-4 bg-surface-interactive border border-border-glass rounded-lg space-y-4">
                  <h4 className="text-xs font-medium text-retro-fg">Display &amp; Layout</h4>

                  {/* Panel opacity */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="panel-opacity" className="text-[11px] text-retro-muted">Panel opacity</label>
                      <span className="text-[11px] font-mono text-retro-fg tabular-nums">{Math.round((settings.panelOpacity ?? 1) * 100)}%</span>
                    </div>
                    <input
                      id="panel-opacity"
                      type="range"
                      min={35}
                      max={100}
                      step={5}
                      value={Math.round((settings.panelOpacity ?? 1) * 100)}
                      onChange={(e) => updateSettings('panelOpacity', Number(e.target.value) / 100)}
                      className="w-full accent-retro-accent cursor-pointer"
                    />
                    <p className="text-[10px] text-retro-muted">Makes panels and cards more see-through. Text keeps its backing.</p>
                  </div>

                  {/* Glass blur */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="glass-blur" className="text-[11px] text-retro-muted">Glass blur</label>
                      <span className="text-[11px] font-mono text-retro-fg tabular-nums">{Math.round((settings.glassBlur ?? 0.7) * 100)}%</span>
                    </div>
                    <input
                      id="glass-blur"
                      type="range"
                      min={0}
                      max={100}
                      step={10}
                      value={Math.round((settings.glassBlur ?? 0.7) * 100)}
                      onChange={(e) => updateSettings('glassBlur', Number(e.target.value) / 100)}
                      className="w-full accent-retro-accent cursor-pointer"
                    />
                    <p className="text-[10px] text-retro-muted">Backdrop frost strength. Lower is faster on weak GPUs; 0% disables it entirely.</p>
                  </div>

                  {/* Animated chrome (perf gate) */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium text-retro-fg">Animated chrome</div>
                      <div className="text-[11px] text-retro-muted">Moving shine on accent buttons/headings. Off is faster; enable for the sparkle.</div>
                    </div>
                    <Switch checked={settings.animatedChrome} onChange={() => updateSettings('animatedChrome', !settings.animatedChrome)} />
                  </div>

                  {/* Feed Columns */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium text-retro-fg">Feed Columns</div>
                      <div className="text-[11px] text-retro-muted">Columns for the main media feed</div>
                    </div>
                    <div className="flex bg-surface-raised border border-border-glass rounded-xl p-1 text-xs font-bold">
                      {(['1', '2', '3', '4', '5'] as const).map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => {
                            playPress(800);
                            updateSettings('feedCols', col);
                          }}
                          className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${settings.feedCols === col
                              ? 'bg-black text-white shadow-xs'
                              : 'text-retro-muted hover:text-retro-fg'
                            }`}
                        >
                          {col}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Gallery Columns */}
                  <div className="flex items-center justify-between gap-4 pt-2 border-t border-border-glass">
                    <div>
                      <div className="text-xs font-medium text-retro-fg">Gallery Columns</div>
                      <div className="text-[11px] text-retro-muted">Columns displayed in card collection grid</div>
                    </div>
                    <div className="flex bg-surface-raised border border-border-glass rounded-xl p-1 text-xs font-bold">
                      {(['2', '3'] as const).map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => {
                            playPress(800);
                            updateSettings('galleryCols', col);
                          }}
                          className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${settings.galleryCols === col
                              ? 'bg-black text-white shadow-xs'
                              : 'text-retro-muted hover:text-retro-fg'
                            }`}
                        >
                          {col}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Display Toggles */}
                  <div className="space-y-3 pt-2 border-t border-border-glass divide-y divide-[#27272a]">
                    {([
                      {
                        label: 'Auto-Refresh Heartbeat Sync',
                        desc: 'Automatically synchronize active online peers and matches every 30s',
                        key: 'autoRefresh' as const,
                      },
                      {
                        label: 'Hide Duplicate Cards',
                        desc: 'Filter redundant images in the public gallery deck',
                        key: 'hideDuplicates' as const,
                      },
                      {
                        label: 'Streamer Privacy Masking',
                        desc: 'Mask peer cryptographic hashes and identifiers',
                        key: 'streamerMode' as const,
                      },
                    ]).map((item) => {
                      const isOn = Boolean(settings[item.key]);
                      return (
                        <div key={item.key} className="pt-3 first:pt-0 flex items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-medium text-retro-fg">{item.label}</div>
                            <div className="text-[11px] text-retro-muted">{item.desc}</div>
                          </div>

                          <Switch
                            checked={isOn}
                                                       onChange={() => {
                              playPress(isOn ? 600 : 900);
                              updateSettings(item.key, !isOn as any);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Match Pacing & Audio */}
                <div className="p-4 bg-surface-interactive border border-border-glass rounded-lg space-y-4">
                  <h4 className="text-xs font-medium text-retro-fg">Match Pacing &amp; Audio</h4>

                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium text-retro-fg">Duel Reveal Pacing</div>
                      <div className="text-[11px] text-retro-muted">Animation suspense speed when revealing cards</div>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(['instant', 'fast', 'dramatic'] as const).map((pacing) => (
                        <button
                          key={pacing}
                          type="button"
                          onClick={() => {
                            playPress(800);
                            updateSettings('duelPacing', pacing);
                          }}
                          className={`px-2.5 py-1 rounded-lg border text-xs font-bold capitalize transition-all cursor-pointer text-center ${settings.duelPacing === pacing
                              ? 'bg-black text-white border-black shadow-sm'
                              : 'bg-surface-raised text-retro-fg border-border-glass hover:bg-surface-interactive'
                            }`}
                        >
                          {pacing}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-2 border-t border-border-glass">
                    <div>
                      <div className="text-xs font-medium text-retro-fg">Chat Notification Sound</div>
                      <div className="text-[11px] text-retro-muted">Audio cue when a new direct message arrives</div>
                    </div>

                    <Switch
                      checked={settings.chatNotificationSfx}
                      onChange={() => {
                        playPress(settings.chatNotificationSfx ? 600 : 900);
                        updateSettings('chatNotificationSfx', !settings.chatNotificationSfx);
                        if (!settings.chatNotificationSfx) playMsgReceive();
                      }}
                    />
                  </div>
                </div>

                {/* Wallpaper & Background Section */}
                <div className="p-4 bg-surface-interactive border border-border-glass rounded-lg space-y-3">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => setWallpaperExpanded(!wallpaperExpanded)}
                  >
                    <div>
                      <h4 className="text-xs font-medium text-retro-fg">Wallpaper Background</h4>
                      <p className="text-[11px] text-retro-muted">Customize application background image or media</p>
                    </div>
                    <button
                      type="button"
                      className="p-1 text-retro-muted hover:text-retro-fg transition-colors"
                    >
                      {wallpaperExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>

                  {wallpaperExpanded && (
                    <div className="space-y-4 pt-3 border-t border-border-glass animate-orbit-fade-in">
                      {/* Presets */}
                      <div className="space-y-2">
                        <div className="text-[11px] text-retro-muted">Presets</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {WALLPAPER_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                playPress(800);
                                updateSettings('wallpaperUrl', preset.url);
                                updateSettings('wallpaperPreset', preset.id);
                                updateSettings('wallpaperMime', '');
                                updateSettings('wallpaperSlideshow', false);
                                setCustomWallpaperInput(preset.url);
                              }}
                              className={`p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer text-left space-y-1 ${settings.wallpaperPreset === preset.id || (!settings.wallpaperUrl && preset.id === 'default')
                                  ? 'bg-black text-white border-black shadow-xs'
                                  : 'bg-surface-raised text-retro-fg border-border-glass hover:bg-surface-interactive'
                                }`}
                            >
                              <Image className="w-3.5 h-3.5" />
                              <div className="truncate text-[11px]">{preset.name}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Upload or URL */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-retro-muted">Custom Image or Media</span>
                          {settings.wallpaperUrl && (
                            <button
                              type="button"
                              onClick={clearWallpaper}
                              className="text-[10px] text-red-500 font-bold hover:underline cursor-pointer"
                            >
                              Reset to Default
                            </button>
                          )}
                        </div>

                        <label className="border-2 border-dashed border-border-glass hover:border-retro-accent rounded-xl bg-surface-raised p-3 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all text-center">
                          <Upload className="w-5 h-5 text-retro-muted" />
                          <span className="text-xs font-bold text-retro-body">Browse file to upload</span>
                          <span className="text-[10px] text-retro-muted">JPG, PNG, WebP, GIF, MP4 (downscaled to 1920px)</span>
                          <input type="file" accept="image/*,video/*" onChange={handleWallpaperFile} className="hidden" />
                        </label>

                        <div className="flex gap-2 pt-1">
                          <input
                            type="text"
                            value={customWallpaperInput}
                            onChange={(e) => setCustomWallpaperInput(e.target.value)}
                            placeholder="Direct image or video URL (https://...)"
                            className="flex-1 bg-surface-raised border border-border-glass rounded-xl px-3 py-2 text-xs text-retro-fg outline-none focus:border-black"
                          />
                          <button
                            type="button"
                            onClick={applyCustomWallpaper}
                            className="px-4 py-2 bg-black hover:bg-surface-elevated text-white rounded-xl text-xs font-bold cursor-pointer"
                          >
                            Apply
                          </button>
                        </div>
                      </div>

                      {/* Fit mode */}
                      <div className="flex items-center justify-between gap-4 pt-1">
                        <div className="text-[11px] text-retro-muted">Image Fit</div>
                        <div className="flex gap-1">
                          {([
                            { id: 'cover', label: 'Fill' },
                            { id: 'contain', label: 'Fit' },
                            { id: 'repeat', label: 'Repeat' },
                          ] as const).map((mode) => (
                            <button
                              key={mode.id}
                              type="button"
                              onClick={() => { playPress(700); updateSettings('wallpaperFit', mode.id); }}
                              className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${settings.wallpaperFit === mode.id
                                  ? 'bg-black text-white border-black'
                                  : 'bg-surface-raised text-retro-muted border-border-glass hover:text-retro-fg'
                                }`}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Slideshow */}
                      <div className="flex items-center justify-between pt-2 border-t border-border-glass">
                        <div>
                          <div className="text-xs font-medium text-retro-fg">Card Slideshow</div>
                          <div className="text-[11px] text-retro-muted">Cycle collected cards as background</div>
                        </div>
                        <Switch
                          checked={settings.wallpaperSlideshow}
                          onChange={() => {
                            playPress(750);
                            updateSettings('wallpaperSlideshow', !settings.wallpaperSlideshow);
                          }}
                        />
                      </div>

                      {settings.wallpaperSlideshow && (
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-[11px] text-retro-muted">Interval:</span>
                          <input
                            type="number"
                            min={3}
                            max={120}
                            step={1}
                            value={Math.round(settings.wallpaperSlideshowInterval / 1000)}
                            onChange={(e) => {
                              const s = Math.max(3, Math.min(120, Number(e.target.value) || 8));
                              updateSettings('wallpaperSlideshowInterval', s * 1000);
                            }}
                            className="w-16 bg-surface-raised border border-border-glass rounded-lg px-2 py-1 text-xs text-retro-fg outline-none focus:border-black"
                          />
                          <span className="text-[11px] text-retro-muted">seconds</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Updates (desktop builds only — hides without the bridge). */}
            {activeTab === 'preferences' && <UpdateSection toast={toast} />}

            {/* ──────── 2. ACCOUNT & SECURITY ──────── */}
            {activeTab === 'account' && (
              <div className="space-y-6 animate-orbit-fade-in">
                {/* Orbit ID Display */}
                <div className="p-4 bg-surface-interactive border border-border-glass rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-retro-muted">
                      Cryptographic Identity Key
                    </span>
                    <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                      <Shield className="w-3 h-3" /> End-to-End Keyed
                    </span>
                  </div>

                  <div className="p-3 bg-surface-raised border border-border-glass rounded-xl flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-retro-fg break-all select-all">
                      {identity?.orbitId || 'Anonymous Session'}
                    </span>

                    <button
                      type="button"
                      onClick={handleCopyId}
                      className="px-3 py-1.5 bg-surface-interactive hover:bg-surface-elevated text-retro-fg rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
                    >
                      {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedId ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>

                  <p className="text-[11px] text-retro-muted leading-relaxed">
                    Your Orbit ID is your private cryptographic key pair. Keys are stored locally on your device.
                  </p>
                </div>

                {/* Account Management Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenIdentityModal?.('export')}
                    className="p-4 bg-surface-raised border border-border-glass hover:border-retro-accent rounded-2xl text-left space-y-1 transition-all cursor-pointer group shadow-xs"
                  >
                    <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center">
                      <Download className="w-4 h-4" />
                    </div>
                    <div className="text-xs font-medium text-retro-fg">Export Identity Backup</div>
                    <p className="text-[11px] text-retro-muted">Save your private keys to log in on other devices</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenIdentityModal?.('login')}
                    className="p-4 bg-surface-raised border border-border-glass hover:border-retro-accent rounded-2xl text-left space-y-1 transition-all cursor-pointer group shadow-xs"
                  >
                    <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-200 text-cyan-400 flex items-center justify-center">
                      <LogIn className="w-4 h-4" />
                    </div>
                    <div className="text-xs font-medium text-retro-fg">Switch Account / Login</div>
                    <p className="text-[11px] text-retro-muted">Import an existing secret key or switch profiles</p>
                  </button>
                </div>

                {/* Danger Zone: Log Out */}
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-medium text-rose-300">Log Out of this Device</h4>
                      <p className="text-[11px] text-rose-300/70">Clears your private keys and session from local storage</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenIdentityModal?.('logout')}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5 shadow-xs"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Log Out</span>
                    </button>
                  </div>
                </div>

                <DeleteAccountSection
                  identity={identity}
                  displayName={(() => {
                    try { return localStorage.getItem('orbit_display_name') || ''; } catch { return ''; }
                  })()}
                  toast={(msg, type) => toast?.(msg, type)}
                  onDeleted={() => onAccountDeleted?.()}
                />
              </div>
            )}

            {/* ──────── 3. FEED & TAGS ──────── */}
            {activeTab === 'feed' && <FeedSettingsTab toast={toast} />}

            {/* ──────── 4. SERVER (no central server topology) ──────── */}
            {activeTab === 'server' && <ServerTab toast={toast} />}
          </div>
        </div>
      </div>
    </div>
  );
}
