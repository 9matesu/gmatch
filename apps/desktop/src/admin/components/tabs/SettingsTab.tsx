"use client";

import {        ConfirmDialog } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { BotSetupPanel } from "../../../components/admin/BotSetupPanel";
import { LootboxAdminPanel } from "../../../components/admin/LootboxAdminPanel";
import { useState, useCallback, useEffect } from "react";
import { Settings, Bot, Box, AlertTriangle,  Save,     Globe,         Zap as ZapIcon } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { OrbitIdentity } from "@orbit/crypto";

interface SettingsTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onAction: (action: string, ...args: unknown[]) => void;
}

export function SettingsTab({ identity, pinVerified, onAction }: SettingsTabProps) {
  const [activeSection, setActiveSection] = useState<"bot" | "lootboxes" | "platform" | "danger">("bot");
  const [discordLink, setDiscordLink] = useState("");
  const [cashoutRateBps, setCashoutRateBps] = useState(12500);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [showCleanPostsConfirm, setShowCleanPostsConfirm] = useState(false);
  const [showMigrateConfirm, setShowMigrateConfirm] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const [discordRes, cashoutRes] = await Promise.all([
        adminApi.getDiscordLink(identity),
        adminApi.getCashoutRate(identity),
      ]);
      if (discordRes.url) setDiscordLink(discordRes.url);
      setCashoutRateBps(cashoutRes.cashoutRateBps);
    } catch {
    }
  }, [identity, pinVerified]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSaveDiscord = async () => {
    if (!identity) return;
    try {
      await adminApi.saveDiscordLink(identity, discordLink);
      fetchSettings();
    } catch {
    }
  };

  const handleSaveCashout = async () => {
    if (!identity) return;
    try {
      await adminApi.saveCashoutRate(identity, cashoutRateBps);
      fetchSettings();
    } catch {
    }
  };

  const handleTriggerCleanup = async () => {
    if (!identity) return;
    setShowCleanupConfirm(false);
    try {
      await adminApi.triggerCleanup(identity);
      onAction("refresh");
    } catch {
    }
  };

  const handleCleanPosts = async () => {
    if (!identity) return;
    setShowCleanPostsConfirm(false);
    try {
      await adminApi.cleanAllPosts(identity);
      onAction("refresh");
    } catch {
    }
  };

  const handleMigrate = async () => {
    if (!identity) return;
    setShowMigrateConfirm(false);
    try {
      await adminApi.migrateLobbyToPosts(identity);
      onAction("refresh");
    } catch {
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-retro-fg">Settings & Operations</h1>
          <p className="text-xs text-retro-muted mt-1">Bot config, platform settings, and danger zone</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 bg-surface-raised border border-border-glass rounded-xl p-1">
        {[
          { id: "bot", label: "Bot & Image API", icon: Bot },
          { id: "lootboxes", label: "Lootboxes", icon: Box },
          { id: "platform", label: "Platform Settings", icon: Settings },
          { id: "danger", label: "Danger Zone", icon: AlertTriangle },
        ].map(section => {
          const Icon = section.icon;
          const active = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id as any)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5",
                active
                  ? "bg-retro-accent text-retro-accent-text"
                  : "text-retro-muted hover:text-retro-fg"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {section.label}
            </button>
          );
        })}
      </div>

      {activeSection === "bot" && (
        <BotSetupPanel identity={identity!} />
      )}

      {activeSection === "lootboxes" && (
        <LootboxAdminPanel identity={identity!} />
      )}

      {activeSection === "platform" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border-glass bg-surface-raised p-5 space-y-6">
            <div className="flex items-center justify-between border-b border-border-glass pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-100">
                <Globe className="w-4 h-4 text-cyan-300" />
                <span>Discord Invite</span>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Discord Invite URL</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={discordLink}
                  onChange={e => setDiscordLink(e.target.value)}
                  placeholder="https://discord.gg/..."
                  className="flex-1 bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-zinc-100 outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  onClick={handleSaveDiscord}
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border-glass bg-surface-raised p-5 space-y-6">
            <div className="flex items-center justify-between border-b border-border-glass pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-100">
                <ZapIcon className="w-4 h-4 text-amber-400" />
                <span>Economy Cashout Rate</span>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Cashout Rate (basis points)</label>
              <p className="text-[11px] text-zinc-500">1 bp = 0.01%. Current: {(cashoutRateBps / 100).toFixed(2)}% (12500 = 125%)</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={cashoutRateBps}
                  onChange={e => setCashoutRateBps(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  min={0}
                  max={100000}
                  className="flex-1 bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-zinc-100 outline-none focus:border-cyan-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handleSaveCashout}
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Rate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSection === "danger" && (
        <div className="space-y-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-300">
              <AlertTriangle className="w-4 h-4" />
              <span>Danger Zone</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              These actions are irreversible and can cause permanent data loss. Use with extreme caution.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-red-300 uppercase tracking-wider">Run Database Cleanup</h3>
                  <p className="text-[10px] text-zinc-500 mt-1">Expires stale content, sweeps orphan blobs, resets daily scores. Cheaper than waiting for the next tick.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCleanupConfirm(true)}
                  className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Run Cleanup
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-red-300 uppercase tracking-wider">Clean ALL Posts & Reset</h3>
                  <p className="text-[10px] text-zinc-500 mt-1">Purges all user posts, media objects, likes and comments platform-wide. Cannot be undone.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCleanPostsConfirm(true)}
                  className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Clean All
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-3 md:col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider">Migrate Lobby → Posts</h3>
                  <p className="text-[10px] text-zinc-500 mt-1">Transfers all lobby board images into user gMatch profiles under Posts, preserving likes and metadata.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMigrateConfirm(true)}
                  className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Migrate Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCleanupConfirm && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setShowCleanupConfirm(false)}
          onConfirm={handleTriggerCleanup}
          title="Run Database Maintenance?"
          description="This will expire stale content, sweep orphan blobs, and reset daily scores. This operation cannot be undone."
          confirmLabel="Run Cleanup"
          variant="danger"
        />
      )}

      {showCleanPostsConfirm && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setShowCleanPostsConfirm(false)}
          onConfirm={handleCleanPosts}
          title="Clean ALL Posts & Reset Data?"
          description="This will PURGE all user posts, media objects, post likes and comments platform-wide to start the website from scratch. THIS CANNOT BE UNDONE."
          confirmLabel="Clean All Posts"
          variant="danger"
        />
      )}

      {showMigrateConfirm && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setShowMigrateConfirm(false)}
          onConfirm={handleMigrate}
          title="Migrate Lobby Board Images to User Posts?"
          description="This transfers all images uploaded to the lobby board into each user's gMatch profile under Posts, preserving their likes and metadata."
          confirmLabel="Migrate Now"
          variant="primary"
        />
      )}
    </div>
  );
}