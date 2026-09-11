"use client";

import React, { useEffect, useState } from "react";
import type { OrbitIdentity } from "@orbit/crypto";
import type { ExportedIdentityPayload } from "../hooks/useIdentity";
import { DropZone } from "./DropZone";
import {
  KeyRound,
  Download,
  Copy,
  Check,
  LogOut,
  AlertTriangle,
  UploadCloud,
  X,
  ShieldCheck,
  FileJson,
} from "lucide-react";

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  identity: OrbitIdentity | null;
  exportIdentity: () => ExportedIdentityPayload | null;
  loginWithExportedId: (data: string | object) => { success: boolean; error?: string; identity?: OrbitIdentity };
  clearIdentity: () => void;
  toast: (msg: string, type?: "error" | "success" | "info") => void;
  initialMode?: "export" | "login" | "logout";
  onIdentityChanged?: (mode: 'login' | 'logout') => void;
  onFullConfigDownload?: () => Promise<boolean>;
  onFullConfigRestore?: (file: File) => Promise<{ success: boolean; message: string }>;
}

export function IdentityModal({
  isOpen,
  onClose,
  identity,
  exportIdentity,
  loginWithExportedId,
  clearIdentity,
  toast,
  initialMode = "export",
  onIdentityChanged,
  onFullConfigDownload,
  onFullConfigRestore,
}: Props) {
  const [mode, setMode] = useState<"export" | "login" | "logout">(initialMode);
  const [keyInput, setKeyInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [configDownloading, setConfigDownloading] = useState(false);
  const [configRestoring, setConfigRestoring] = useState(false);

  useEffect(() => {
    if (isOpen) setMode(initialMode);
  }, [initialMode, isOpen]);

  if (!isOpen) return null;

  const exportedData = exportIdentity();
  const exportedString = exportedData ? JSON.stringify(exportedData, null, 2) : "";
  const encodedString = exportedData ? encodeBase64(JSON.stringify(exportedData)) : "";

  const handleCopyKey = async (textToCopy: string, label: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      // Real key-save evidence: silence the beforeunload exit gate (1.0.1 —
      // orbit_key_saved was previously read but never written, so EVERY user
      // was gated forever and the app felt uncloseable).
      try { localStorage.setItem('orbit_key_saved', 'true'); } catch {}
      setCopied(true);
      toast(`${label} copied.`, "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Failed to copy to clipboard", "error");
    }
  };

  const handleDownloadKeyfile = () => {
    if (!exportedData) return;
    try {
      const blob = new Blob([exportedString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `goonmatch-${(exportedData.orbitId || "id").slice(0, 8)}.orbit-key.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("Identity keyfile downloaded", "success");
    } catch {
      toast("Failed to download keyfile", "error");
    }
  };

  const handleLoginSubmit = (rawInput?: string) => {
    const input = (rawInput || keyInput).trim();
    if (!input) {
      toast("Please enter your secret key string or file", "error");
      return;
    }

    setSubmitting(true);
    const result = loginWithExportedId(input);
    setSubmitting(false);

    if (!result.success) {
      toast(result.error || "Failed to restore identity with provided key", "error");
      return;
    }

    toast("Identity restored.", "success");
    onClose();
    onIdentityChanged?.('login');
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === "string") {
        setKeyInput(content);
        handleLoginSubmit(content);
      }
    };
    reader.onerror = () => toast("Failed to read key file", "error");
    reader.readAsText(file);
  };

  const handleConfirmLogout = () => {
    clearIdentity();
    toast("Logged out", "info");
    onClose();
    onIdentityChanged?.('logout');
  };

  const handleFullConfigDownload = async () => {
    if (!onFullConfigDownload) {
      toast("Full config backup is not available in this context", "error");
      return;
    }
    setConfigDownloading(true);
    try {
      const ok = await onFullConfigDownload();
      if (ok) toast("Full config backup downloaded", "success");
    } finally {
      setConfigDownloading(false);
    }
  };

  const handleFullConfigRestore = async (file: File) => {
    if (!onFullConfigRestore) {
      toast("Full config restore is not available in this context", "error");
      return;
    }
    setConfigRestoring(true);
    try {
      const result = await onFullConfigRestore(file);
      if (result.success) {
        toast(result.message, "success");
        onClose();
        onIdentityChanged?.('login');
      } else {
        toast(result.message, "error");
      }
    } catch {
      toast("Failed to restore config backup", "error");
    } finally {
      setConfigRestoring(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-system)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-border-glass w-full max-w-lg rounded-lg shadow-xl overflow-hidden animate-orbit-pop flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-retro-muted" />
            <h2 className="text-sm font-medium text-retro-fg">
              {mode === "export" && "Identity & Keys"}
              {mode === "login" && "Log In / Restore"}
              {mode === "logout" && "Sign Out"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-retro-muted hover:text-retro-fg p-1 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-border-glass p-1 gap-0.5">
          <button
            type="button"
            onClick={() => setMode("export")}
            className={`flex-1 py-1.5 text-center rounded text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              mode === "export" ? "bg-surface-interactive text-retro-fg" : "text-retro-muted hover:text-retro-fg"
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 py-1.5 text-center rounded text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              mode === "login" ? "bg-surface-interactive text-retro-fg" : "text-retro-muted hover:text-retro-fg"
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Log In</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("logout")}
            className={`flex-1 py-1.5 text-center rounded text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              mode === "logout" ? "bg-rose-500/10 text-rose-400" : "text-rose-400/60 hover:text-rose-400"
            }`}
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto styled-scrollbar">
          {mode === "export" && (
            <div className="space-y-4">
              <div className="p-3 bg-surface-interactive border border-border-glass rounded-lg space-y-1">
                <div className="text-xs font-medium text-retro-muted">Your Orbit ID</div>
                <div className="font-mono text-xs text-retro-body break-all select-all">
                  {identity?.orbitId || "Not loaded"}
                </div>
              </div>

              <div className="p-3 bg-retro-warning/5 border border-retro-warning/20 rounded-lg text-xs text-retro-fg leading-relaxed flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-retro-warning shrink-0 mt-0.5" />
                <div>
                  <strong className="font-medium text-retro-warning">Secret key:</strong> Anyone with this key can access your profile, cards, and rank.
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-retro-muted block">
                  Encoded backup key
                </label>
                <textarea
                  readOnly
                  value={encodedString}
                  rows={3}
                  className="w-full bg-surface-interactive border border-border-glass p-2.5 text-xs font-mono text-retro-body rounded-lg outline-none select-all resize-none"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyKey(encodedString, "Secret key string")}
                  className="flex-1 py-2.5 px-3 bg-surface-interactive border border-border-glass text-retro-body font-medium text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 hover:border-border-strong"
                >
                  {copied ? <><Check className="w-3.5 h-3.5 text-retro-online" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy key</>}
                </button>

                <button
                  type="button"
                  onClick={handleDownloadKeyfile}
                  className="flex-1 py-2.5 px-3 bg-surface-interactive border border-border-glass text-retro-body font-medium text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 hover:border-border-strong"
                >
                  <FileJson className="w-3.5 h-3.5" />
                  <span>Download .json</span>
                </button>
              </div>

              <div className="border-t border-border-glass pt-3 space-y-2">
                <div className="text-xs font-medium text-retro-muted">
                  Full backup
                </div>
                <p className="text-xs text-retro-muted leading-relaxed">
                  Back up identity, settings, card collection, stash, and friends in one file.
                </p>
                <button
                  type="button"
                  disabled={configDownloading}
                  onClick={() => void handleFullConfigDownload()}
                  className="w-full py-2.5 px-3 bg-surface-interactive border border-border-glass text-retro-body font-medium text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2 hover:border-border-strong"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{configDownloading ? "Preparing..." : "Download full backup"}</span>
                </button>
              </div>
            </div>
          )}

          {mode === "login" && (
            <div className="space-y-4">
              <p className="text-xs text-retro-muted leading-relaxed">
                Paste your secret key or drop your saved key file to restore your account.
              </p>

              <textarea
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                placeholder="Paste backup key string, private key, or JSON..."
                rows={4}
                className="w-full bg-surface-interactive border border-border-glass p-3 text-xs font-mono text-retro-fg placeholder:text-retro-muted rounded-lg outline-none focus:border-retro-accent resize-none"
              />

              <DropZone
                compact
                onFiles={(files) => {
                  if (files[0]) handleFileUpload(files[0]);
                }}
              >
                <div className="p-3 text-center">
                  <div className="text-xs font-medium text-retro-body">
                    Drop .json keyfile or click to browse
                  </div>
                </div>
              </DropZone>

              <div className="border-t border-border-glass pt-3 space-y-2">
                <div className="text-xs font-medium text-retro-muted">
                  Restore full backup
                </div>
                <p className="text-xs text-retro-muted leading-relaxed">
                  Drop a <span className="text-retro-accent font-mono">.goon-config.json</span> backup to restore everything.
                </p>
                <DropZone
                  compact
                  onFiles={(files) => {
                    if (files[0]) void handleFullConfigRestore(files[0]);
                  }}
                >
                  <div className={`p-3 text-center border rounded-lg ${configRestoring ? "border-retro-accent/30 bg-glass-w5" : "border-border-glass"}`}>
                    <div className="text-xs font-medium text-retro-accent">
                      {configRestoring ? "Restoring..." : "Drop .goon-config.json here"}
                    </div>
                  </div>
                </DropZone>
              </div>

              <button
                type="button"
                disabled={submitting || !keyInput.trim()}
                onClick={() => handleLoginSubmit()}
                className="w-full py-2.5 bg-retro-accent hover:bg-retro-accent-hover text-black font-medium text-xs rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? "Restoring..." : "Restore & Log In"}
              </button>
            </div>
          )}

          {mode === "logout" && (
            <div className="space-y-4 text-center py-2">
              <div className="w-10 h-10 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mx-auto">
                <AlertTriangle className="w-5 h-5" />
              </div>

              <div className="space-y-1">
                <h3 className="text-sm font-medium text-retro-fg">
                  Sign out?
                </h3>
                <p className="text-xs text-retro-muted max-w-sm mx-auto leading-relaxed">
                  This wipes your local secret keys and creates a fresh anonymous identity. Export your key first if you want to log back in later.
                </p>
              </div>

              <div className="flex gap-2 pt-2 max-w-sm mx-auto">
                <button
                  type="button"
                  onClick={() => setMode("export")}
                  className="flex-1 py-2.5 bg-surface-interactive border border-border-glass text-retro-body font-medium text-xs rounded-lg transition-colors cursor-pointer hover:border-border-strong"
                >
                  Export key first
                </button>

                <button
                  type="button"
                  onClick={handleConfirmLogout}
                  className="flex-1 py-2.5 bg-rose-500/15 text-rose-400 font-medium text-xs rounded-lg transition-colors cursor-pointer hover:bg-rose-500/20"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
