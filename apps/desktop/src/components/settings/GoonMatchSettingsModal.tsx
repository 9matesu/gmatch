"use client";

import React, { useState } from 'react';
import type { AppSettings } from '../../hooks/useSettings';
import type { OrbitIdentity } from '@orbit/crypto';
import { orbitFetch } from '../../utils/api';
import { playPress, playChatMessage, playMsgReceive } from '../../utils/sounds';
import {
  Settings,
  User,
  Shield,
  Zap,
  Volume2,
  Image,
  MessageSquare,
  FileText,
  X,
  Check,
  Copy,
  Download,
  LogIn,
  LogOut,
  ChevronRight,
  Moon,
  Upload,
  Send,
} from 'lucide-react';

export type SettingsTabId =
  | 'preferences'
  | 'account'
  | 'domination'
  | 'audio'
  | 'wallpaper'
  | 'feedback'
  | 'legal';

interface GoonMatchSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  identity: OrbitIdentity | null;
  onOpenIdentityModal?: (mode: 'export' | 'login' | 'logout') => void;
  toast?: (msg: string, type?: 'error' | 'success' | 'info' | 'warning' | any) => void;
  initialTab?: SettingsTabId;
}

const WALLPAPER_PRESETS = [
  { id: 'default', name: 'Default Minimal', url: '' },
  { id: 'grid', name: 'Cyber Grid Neon', url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1920&q=80' },
  { id: 'space', name: 'Deep Space Orbit', url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1920&q=80' },
  { id: 'minimal', name: 'Studio Gradient', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1920&q=80' },
];

export function GoonMatchSettingsModal({
  isOpen,
  onClose,
  settings,
  updateSettings,
  identity,
  onOpenIdentityModal,
  toast,
  initialTab = 'preferences',
}: GoonMatchSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [copiedId, setCopiedId] = useState(false);
  const [customWallpaperInput, setCustomWallpaperInput] = useState(settings.wallpaperUrl || '');

  // Feedback form state
  const [fbCategory, setFbCategory] = useState<'Feature' | 'UI' | 'Idea' | 'Bug'>('Feature');
  const [fbContent, setFbContent] = useState('');
  const [fbSubmitting, setFbSubmitting] = useState(false);

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
      // Downscale large images to ~1920px wide so the base64 data URL stays
      // small enough to persist in localStorage (survives reload).
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

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fbContent.trim()) return;
    setFbSubmitting(true);
    try {
      if (identity) {
        const res = await orbitFetch(
          '/api/recommendations',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: fbCategory, content: fbContent.trim() }),
          },
          identity
        );
        if (res.ok) {
          playChatMessage();
          toast?.('Thank you! Feedback received.', 'success');
          setFbContent('');
        } else {
          toast?.('Could not submit feedback.', 'error');
        }
      }
    } catch {
      toast?.('Submission error.', 'error');
    } finally {
      setFbSubmitting(false);
    }
  };

  const navItems: { id: SettingsTabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'preferences', label: 'Preferences', icon: Settings },
    { id: 'account', label: 'Account & Security', icon: User },
    { id: 'domination', label: 'PC Domination', icon: Zap },
    { id: 'audio', label: 'Match Pacing', icon: Volume2 },
    { id: 'wallpaper', label: 'Wallpaper Background', icon: Image },
    { id: 'feedback', label: 'Feedback & Ideas', icon: MessageSquare },
    { id: 'legal', label: 'Guidelines & Terms', icon: FileText },
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
        <div className="w-full md:w-56 border-b md:border-b-0 md:border-r border-retro-border bg-surface-raised flex flex-col shrink-0">
          {/* Header */}
          <div className="p-4 border-b border-retro-border flex items-center justify-between">
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
          <div className="hidden md:flex mt-auto p-3 border-t border-retro-border items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-surface-interactive flex items-center justify-center font-medium text-xs text-retro-muted">
                {identity?.orbitId?.substring(0, 1).toUpperCase() || 'U'}
              </div>
              <div className="min-w-0">
                <span className="text-xs font-medium block truncate">{identity?.orbitId ? `@${identity.orbitId.substring(0, 8)}` : 'Guest'}</span>
                <span className="text-[10px] text-retro-online">Online</span>
              </div>
            </div>
            <span className="text-[10px] font-mono text-retro-muted">v0.1.0</span>
          </div>
        </div>

        {/* Right Main Content Pane */}
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-raised">
          {/* Top Bar */}
          <div className="hidden md:flex items-center justify-between px-5 py-3.5 border-b border-retro-border">
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
            {/* ──────── 1. PREFERENCES & INTERFACE ──────── */}
            {activeTab === 'preferences' && (
              <div className="space-y-6 animate-orbit-fade-in">
                {/* Theme Selector */}
                <div className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-medium text-retro-fg">Appearance &amp; Theme</h4>
                      <p className="text-[11px] text-retro-muted">Choose your visual experience across the app</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between px-3 py-2.5 rounded-2xl bg-surface-canvas border border-zinc-800">
                    <div className="flex items-center gap-2.5">
                      <Moon className="w-4 h-4 text-cyan-400" />
                      <div>
                        <p className="text-xs font-medium text-retro-fg">Dark Obsidian</p>
                        <p className="text-[10px] text-retro-muted">goonMatch metallic theme — always on</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-400/10 text-cyan-400 border border-cyan-400/30">Active</span>
                  </div>
                </div>

                {/* Display Toggles */}
                <div className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3">
                  <h4 className="text-xs font-medium text-retro-fg">Navigation &amp; Layout</h4>
                  <div className="space-y-3 divide-y divide-[#27272a]">
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
                    ]).map((item) => {
                      const isOn = Boolean(settings[item.key]);
                      return (
                        <div key={item.key} className="pt-3 first:pt-0 flex items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-medium text-retro-fg">{item.label}</div>
                            <div className="text-[11px] text-retro-muted">{item.desc}</div>
                          </div>

                          {/* Instagram Style Toggle Switch */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isOn}
                            onClick={() => {
                              playPress(isOn ? 600 : 900);
                              updateSettings(item.key, !isOn as any);
                            }}
                            className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${isOn ? 'bg-retro-accent' : 'bg-surface-interactive'
                              }`}
                          >
                            <div
                              className={`w-5 h-5 rounded-full bg-surface-raised shadow-md transition-transform ${isOn ? 'translate-x-5' : 'translate-x-0'
                                }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Card Columns Preference */}
                <div className="p-4 bg-surface-raised border border-border-glass rounded-2xl flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-medium text-retro-fg">Gallery Grid Density</h4>
                    <p className="text-[11px] text-retro-muted">Number of columns displayed in the card collection grid</p>
                  </div>

                  <div className="flex bg-surface-interactive border border-border-glass rounded-xl p-1 text-xs font-bold">
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
                        {col} Cols
                      </button>
                    ))}
                  </div>
                </div>

                {/* Feed Column Density Preference */}
                <div className="p-4 bg-surface-raised border border-border-glass rounded-2xl flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-medium text-retro-fg">Feed Columns</h4>
                    <p className="text-[11px] text-retro-muted">Number of columns for the main feed (1 = classic single column)</p>
                  </div>

                  <div className="flex bg-surface-interactive border border-border-glass rounded-xl p-1 text-xs font-bold">
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
                        {col} Col
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ──────── 2. ACCOUNT & SECURITY ──────── */}
            {activeTab === 'account' && (
              <div className="space-y-6 animate-orbit-fade-in">
                {/* Orbit ID Display */}
                <div className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3">
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
                    Your Orbit ID is your private cryptographic key pair. You are completely decentralized and sovereign.
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
                    <p className="text-[11px] text-retro-muted">Download your private keys to log in on other devices</p>
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
                    <p className="text-[11px] text-retro-muted">Import an existing key file or switch between profiles</p>
                  </button>
                </div>

                {/* Danger Zone: Log Out */}
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-medium text-rose-300">Log Out of this Browser</h4>
                      <p className="text-[11px] text-rose-300/70">Clears your private keys from local storage</p>
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
              </div>
            )}

            {/* ──────── 3. PC DOMINATION & TAKEOVER ──────── */}
            {activeTab === 'domination' && (
              <div className="space-y-6 animate-orbit-fade-in">
                {/* Master Switch Card */}
                <div className="p-5 bg-gradient-to-r from-cyan-950/60 via-zinc-900 to-amber-950/40 border border-border-glass rounded-2xl space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-cyan-500 text-black flex items-center justify-center shadow-md">
                        <Zap className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-retro-fg">Domination Master Mode</h4>
                        <p className="text-[11px] text-retro-muted">Automate fullscreen and media triggers when receiving cards</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.dominationMode}
                      onClick={() => {
                        playPress(settings.dominationMode ? 600 : 900);
                        updateSettings('dominationMode', !settings.dominationMode);
                      }}
                      className={`w-12 h-7 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${settings.dominationMode ? 'bg-cyan-500' : 'bg-surface-interactive'
                        }`}
                    >
                      <div
                        className={`w-6 h-6 rounded-full bg-surface-raised shadow-md transition-transform ${settings.dominationMode ? 'translate-x-5' : 'translate-x-0'
                          }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Sub Features */}
                <div className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3">
                  <h4 className="text-xs font-medium text-retro-fg">Automated Takeover Behaviors</h4>
                  <div className="space-y-3 divide-y divide-[#27272a]">
                    {([
                      {
                        label: 'Full-Screen Takeover',
                        desc: 'Auto-launch received duel cards in immersive full-screen view',
                        key: 'dominationFullscreen' as const,
                      },
                      {
                        label: 'Desktop Wallpaper Takeover',
                        desc: 'Automatically set incoming card art as desktop wallpaper background',
                        key: 'dominationWallpaper' as const,
                      },
                      {
                        label: 'Autoplay Media Sound',
                        desc: 'Unmute and play video clips with full audio volume upon arrival',
                        key: 'dominationAutoplayAudio' as const,
                      },
                      {
                        label: 'Auto-Save to Card Deck',
                        desc: 'Automatically add incoming cards to your permanent collection',
                        key: 'dominationAutoSave' as const,
                      },
                    ]).map((sub) => {
                      const isOn = Boolean(settings[sub.key]);
                      return (
                        <div key={sub.key} className="pt-3 first:pt-0 flex items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-medium text-retro-fg">{sub.label}</div>
                            <div className="text-[11px] text-retro-muted">{sub.desc}</div>
                          </div>

                          <button
                            type="button"
                            role="switch"
                            aria-checked={isOn}
                            disabled={!settings.dominationMode}
                            onClick={() => {
                              playPress(isOn ? 600 : 900);
                              updateSettings(sub.key, !isOn as any);
                            }}
                            className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 disabled:opacity-40 ${isOn && settings.dominationMode ? 'bg-retro-accent' : 'bg-surface-interactive'
                              }`}
                          >
                            <div
                              className={`w-5 h-5 rounded-full bg-surface-raised shadow-md transition-transform ${isOn && settings.dominationMode ? 'translate-x-5' : 'translate-x-0'
                                }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ──────── 4. MATCH PACING ──────── */}
            {activeTab === 'audio' && (
              <div className="space-y-6 animate-orbit-fade-in">
                {/* Duel Suspense Pacing */}
                <div className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-medium text-retro-fg">Duel Reveal Pacing</h4>
                      <p className="text-[11px] text-retro-muted">Animation suspense speed when revealing cards in 1v1</p>
                    </div>
                    <span className="text-[10px] font-medium text-retro-accent">{settings.duelPacing}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {(['instant', 'fast', 'dramatic'] as const).map((pacing) => (
                      <button
                        key={pacing}
                        type="button"
                        onClick={() => {
                          playPress(800);
                          updateSettings('duelPacing', pacing);
                        }}
                        className={`p-3 rounded-2xl border text-xs font-bold capitalize transition-all cursor-pointer text-center ${settings.duelPacing === pacing
                            ? 'bg-black text-white border-black shadow-sm'
                            : 'bg-surface-raised text-retro-fg border-border-glass hover:bg-surface-interactive'
                          }`}
                      >
                        {pacing}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Streamer / Privacy Mode */}
                <div className="p-4 bg-surface-raised border border-border-glass rounded-2xl flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-medium text-retro-fg">Streamer &amp; Privacy Masking</h4>
                    <p className="text-[11px] text-retro-muted">Mask sensitive peer cryptographic hashes on live streams</p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.streamerMode}
                    onClick={() => {
                      playPress(settings.streamerMode ? 600 : 900);
                      updateSettings('streamerMode', !settings.streamerMode);
                    }}
                    className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${settings.streamerMode ? 'bg-retro-accent' : 'bg-surface-interactive'
                      }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-surface-raised shadow-md transition-transform ${settings.streamerMode ? 'translate-x-5' : 'translate-x-0'
                        }`}
                    />
                  </button>
                </div>

                {/* Chat notification sound */}
                <div className="p-4 bg-surface-raised border border-border-glass rounded-2xl flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-medium text-retro-fg">Chat Notification Sound</h4>
                    <p className="text-[11px] text-retro-muted">Dry rimshot cue when a new private message arrives</p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.chatNotificationSfx}
                    onClick={() => {
                      playPress(settings.chatNotificationSfx ? 600 : 900);
                      updateSettings('chatNotificationSfx', !settings.chatNotificationSfx);
                      if (!settings.chatNotificationSfx) playMsgReceive();
                    }}
                    className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${settings.chatNotificationSfx ? 'bg-retro-accent' : 'bg-surface-interactive'
                      }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-surface-raised shadow-md transition-transform ${settings.chatNotificationSfx ? 'translate-x-5' : 'translate-x-0'
                        }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* ──────── 5. WALLPAPER & BACKGROUND ──────── */}
            {activeTab === 'wallpaper' && (
              <div className="space-y-6 animate-orbit-fade-in">
                {/* Wallpaper Presets */}
                <div className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3">
                  <h4 className="text-xs font-medium text-retro-fg">Preset Wallpapers</h4>
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
                        className={`p-3 rounded-2xl border text-xs font-bold transition-all cursor-pointer text-left space-y-1 ${settings.wallpaperPreset === preset.id || (!settings.wallpaperUrl && preset.id === 'default')
                            ? 'bg-black text-white border-black shadow-xs'
                            : 'bg-surface-raised text-retro-fg border-border-glass hover:bg-surface-interactive'
                          }`}
                      >
                        <Image className="w-4 h-4" />
                        <div className="truncate">{preset.name}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Upload or URL */}
                <div className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-medium text-retro-fg">Custom Image Background</h4>
                    {settings.wallpaperUrl && (
                      <button
                        type="button"
                        onClick={clearWallpaper}
                        className="text-[10px] text-red-600 font-bold hover:underline cursor-pointer"
                      >
                        Reset to Default
                      </button>
                    )}
                  </div>

                  {/* Drag-and-drop / file selector zone */}
                  <label className="border-2 border-dashed border-border-glass hover:border-retro-accent rounded-2xl bg-surface-raised p-4 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all text-center">
                    <Upload className="w-6 h-6 text-retro-muted" />
                    <span className="text-xs font-bold text-retro-body">Drag &amp; drop wallpaper or click to browse</span>
                    <span className="text-[10px] text-retro-muted">Supports JPG, PNG, WebP, GIF, MP4 (images downscaled to 1920px)</span>
                    <input type="file" accept="image/*,video/*" onChange={handleWallpaperFile} className="hidden" />
                  </label>

                  <div className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={customWallpaperInput}
                      onChange={(e) => setCustomWallpaperInput(e.target.value)}
                      placeholder="Or paste direct image / mp4 URL (https://...)"
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
                <div className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3">
                  <h4 className="text-xs font-medium text-retro-fg">Image Fit</h4>
                  <div className="flex gap-2">
                    {([
                      { id: 'cover', label: 'Fill' },
                      { id: 'contain', label: 'Fit' },
                      { id: 'repeat', label: 'Repeat' },
                    ] as const).map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => { playPress(700); updateSettings('wallpaperFit', mode.id); }}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${settings.wallpaperFit === mode.id
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
                <div className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-medium text-retro-fg">Slideshow</h4>
                      <p className="text-[11px] text-retro-muted mt-0.5">Cycle through your own gallery cards as the background.</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.wallpaperSlideshow}
                      onClick={() => {
                        playPress(750);
                        updateSettings('wallpaperSlideshow', !settings.wallpaperSlideshow);
                      }}
                      className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${settings.wallpaperSlideshow ? 'bg-retro-accent' : 'bg-surface-raised border border-border-glass'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${settings.wallpaperSlideshow ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                  {settings.wallpaperSlideshow && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-retro-muted">Interval</span>
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
                        className="w-20 bg-surface-raised border border-border-glass rounded-xl px-2 py-1.5 text-xs text-retro-fg outline-none focus:border-black"
                      />
                      <span className="text-[11px] text-retro-muted">seconds</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ──────── 6. FEEDBACK & SUGGESTIONS ──────── */}
            {activeTab === 'feedback' && (
              <form onSubmit={handleFeedbackSubmit} className="space-y-4 animate-orbit-fade-in">
                <div className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3">
                  <h4 className="text-xs font-medium text-retro-fg">Submit Ideas or Report an Issue</h4>
                  <p className="text-[11px] text-retro-muted">
                    Your suggestions directly influence upcoming goonMatch features and design improvements.
                  </p>

                  <div className="flex gap-2 pt-1">
                    {(['Feature', 'UI', 'Idea', 'Bug'] as const).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setFbCategory(cat)}
                        className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${fbCategory === cat
                            ? 'bg-black text-white border-black'
                            : 'bg-surface-raised text-retro-muted border-border-glass hover:text-retro-fg'
                          }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  <textarea
                    rows={4}
                    value={fbContent}
                    onChange={(e) => setFbContent(e.target.value)}
                    placeholder="Share your thoughts, feature requests, or bug details..."
                    className="w-full bg-surface-raised border border-border-glass rounded-2xl p-3 text-xs text-retro-fg outline-none focus:border-black resize-none"
                  />

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={!fbContent.trim() || fbSubmitting}
                      className="px-5 py-2.5 bg-retro-accent hover:bg-retro-accent-hover disabled:opacity-40 text-black rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{fbSubmitting ? 'Sending...' : 'Send Feedback'}</span>
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* ──────── 7. GUIDELINES & TERMS ──────── */}
            {activeTab === 'legal' && (
              <div className="p-5 bg-surface-raised border border-border-glass rounded-2xl space-y-4 text-xs text-retro-muted leading-relaxed animate-orbit-fade-in">
                <div className="flex items-center gap-2 pb-2 border-b border-border-glass">
                  <FileText className="w-4 h-4 text-retro-fg" />
                  <h4 className="text-sm font-medium text-retro-fg">Community Guidelines &amp; Terms</h4>
                </div>

                <div className="space-y-3">
                  <p>
                    <strong className="text-retro-fg">1. Decentralized &amp; Sovereign:</strong> You own your keys and identity. No centralized surveillance or third-party data tracking.
                  </p>
                  <p>
                    <strong className="text-retro-fg">2. Age Requirement:</strong> You must be 18 years or older to participate in community feeds and duels.
                  </p>
                  <p>
                    <strong className="text-retro-fg">3. Zero Tolerance Policy:</strong> Absolute zero tolerance for non-consensual content, CSAM, harassment, or illegal material. Violations result in immediate cryptographic node bans.
                  </p>
                  <p>
                    <strong className="text-retro-fg">4. Primary Deploy:</strong> Official hosted node is available at{' '}
                    <a href="https://goonmatch.fly.dev" target="_blank" rel="noopener noreferrer" className="text-cyan-400 font-bold hover:underline">
                      https://goonmatch.fly.dev/
                    </a>.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
