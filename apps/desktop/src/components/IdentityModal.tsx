"use client";

import React, { useEffect, useState } from "react";
import type { OrbitIdentity } from "@orbit/crypto";
import type { ExportedIdentityPayload } from "../hooks/useIdentity";
import { DropZone } from "./DropZone";
import { Button, Textarea } from "../ui/kit";
import {
  classes, CHROME, COLOR, GAP, ICON, MOTION, PADDING,
  RADIUS, RECIPE, STATUS, TRACKING, TYPE, WEIGHT,
} from "../ui/tokens";
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
    <div className={classes(RECIPE.modalOverlay, 'select-none font-sans')}>
      <div
        className={classes(CHROME.overlayPanel, 'w-full max-w-lg overflow-hidden flex flex-col', MOTION.keyframe.pop)}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={classes(RECIPE.modalHeader)}>
          <div className={classes('flex items-center', GAP[2])}>
            <KeyRound className={classes(ICON.md, COLOR.muted)} />
            <h2 className={classes(TYPE.body, WEIGHT.medium, COLOR.fg)}>
              {mode === "export" && "Identity & Keys"}
              {mode === "login" && "Log In / Restore"}
              {mode === "logout" && "Sign Out"}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close identity dialog"
            className={PADDING[1]}
          >
            <X className={ICON.md} />
          </Button>
        </div>

        {/* Tab switcher — one recipe for all three modes, danger only on Log Out. */}
        <div className={classes('flex border-b', COLOR.edge, PADDING[1], GAP[0.5])}>
          <Button
            type="button"
            variant={mode === "export" ? "secondary" : "ghost"}
            onClick={() => setMode("export")}
            className={classes('flex-1', TYPE.body, WEIGHT.medium)}
          >
            <KeyRound className={ICON.sm} />
            <span>Export</span>
          </Button>
          <Button
            type="button"
            variant={mode === "login" ? "secondary" : "ghost"}
            onClick={() => setMode("login")}
            className={classes('flex-1', TYPE.body, WEIGHT.medium)}
          >
            <UploadCloud className={ICON.sm} />
            <span>Log In</span>
          </Button>
          <Button
            type="button"
            variant={mode === "logout" ? "danger" : "ghost"}
            onClick={() => setMode("logout")}
            className={classes('flex-1', TYPE.body, WEIGHT.medium)}
          >
            <LogOut className={ICON.sm} />
            <span>Log Out</span>
          </Button>
        </div>

        <div className={classes(PADDING[4], 'space-y-4 max-h-(--max-h-sheet) overflow-y-auto styled-scrollbar')}>
          {mode === "export" && (
            <div className="space-y-4">
              <div className={classes(PADDING[3], COLOR.interactive, 'border', COLOR.edge, RADIUS.control, 'space-y-1')}>
                <div className={classes(TYPE.body, WEIGHT.medium, COLOR.muted)}>Your Orbit ID</div>
                <div className={classes('font-mono', TYPE.body, COLOR.body, 'break-all select-all')}>
                  {identity?.orbitId || "Not loaded"}
                </div>
              </div>

              <div className={classes(PADDING[3], STATUS.warningBg, STATUS.warningEdge, RADIUS.control, TYPE.body, COLOR.fg, 'leading-relaxed flex items-start', GAP[2])}>
                <ShieldCheck className={classes(ICON.md, STATUS.warning, 'shrink-0 mt-0.5')} />
                <div>
                  <strong className={classes(WEIGHT.medium, STATUS.warning)}>Secret key:</strong> Anyone with this key can access your profile, cards, and rank.
                </div>
              </div>

              <div className={classes('space-y-1.5')}>
                <label htmlFor="identity-backup-key" className={classes(TYPE.body, WEIGHT.medium, COLOR.muted, 'block')}>
                  Encoded backup key
                </label>
                <Textarea
                  id="identity-backup-key"
                  readOnly
                  value={encodedString}
                  rows={3}
                  className="select-all"
                />
              </div>

              <div className={classes('flex flex-col sm:flex-row', GAP[2])}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleCopyKey(encodedString, "Secret key string")}
                  className={classes('flex-1', 'flex items-center justify-center', GAP[1.5], COLOR.hoverEdgeStrong)}
                >
                  {copied ? <><Check className={classes(ICON.sm, 'text-retro-online')} /> Copied</> : <><Copy className={ICON.sm} /> Copy key</>}
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleDownloadKeyfile}
                  className={classes('flex-1', 'flex items-center justify-center', GAP[1.5], COLOR.hoverEdgeStrong)}
                >
                  <FileJson className={ICON.sm} />
                  <span>Download .json</span>
                </Button>
              </div>

              <div className={classes('border-t', COLOR.edge, 'pt-3 space-y-2')}>
                <div className={classes(TYPE.body, WEIGHT.medium, COLOR.muted)}>Full backup</div>
                <p className={classes(TYPE.body, COLOR.muted, 'leading-relaxed')}>
                  Back up identity, settings, card collection, stash, and friends in one file.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={configDownloading}
                  onClick={() => void handleFullConfigDownload()}
                  className={classes('w-full', 'flex items-center justify-center', GAP[2], COLOR.hoverEdgeStrong)}
                >
                  <Download className={ICON.sm} />
                  <span>{configDownloading ? "Preparing..." : "Download full backup"}</span>
                </Button>
              </div>
            </div>
          )}

          {mode === "login" && (
            <div className="space-y-4">
              <p className={classes(TYPE.body, COLOR.muted, 'leading-relaxed')}>
                Paste your secret key or drop your saved key file to restore your account.
              </p>

              <Textarea
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                placeholder="Paste backup key string, private key, or JSON..."
                rows={4}
              />

              <DropZone
                compact
                onFiles={(files) => {
                  if (files[0]) handleFileUpload(files[0]);
                }}
              >
                <div className={classes(PADDING[3], 'text-center', TYPE.body, WEIGHT.medium, COLOR.body)}>
                  Drop .json keyfile or click to browse
                </div>
              </DropZone>

              <div className={classes('border-t', COLOR.edge, 'pt-3 space-y-2')}>
                <div className={classes(TYPE.body, WEIGHT.medium, COLOR.muted)}>Restore full backup</div>
                <p className={classes(TYPE.body, COLOR.muted, 'leading-relaxed')}>
                  Drop a <span className={classes(COLOR.accent, 'font-mono')}>.goon-config.json</span> backup to restore everything.
                </p>
                <DropZone
                  compact
                  onFiles={(files) => {
                    if (files[0]) void handleFullConfigRestore(files[0]);
                  }}
                >
                  <div className={classes(PADDING[3], 'text-center border', RADIUS.control, configRestoring ? classes('border-retro-accent/30', COLOR.glassW5) : COLOR.edge)}>
                    <div className={classes(TYPE.body, WEIGHT.medium, COLOR.accent)}>
                      {configRestoring ? "Restoring..." : "Drop .goon-config.json here"}
                    </div>
                  </div>
                </DropZone>
              </div>

              <Button
                type="button"
                variant="primary"
                disabled={submitting || !keyInput.trim()}
                onClick={() => handleLoginSubmit()}
                className="w-full"
              >
                {submitting ? "Restoring..." : "Restore & Log In"}
              </Button>
            </div>
          )}

          {mode === "logout" && (
            <div className={classes('space-y-4 text-center py-2')}>
              <div className={classes('w-10 h-10', RADIUS.control, STATUS.dangerBg, STATUS.dangerEdge, 'flex items-center justify-center', STATUS.danger, 'mx-auto')}>
                <AlertTriangle className={ICON.lg} />
              </div>

              <div className={classes('space-y-1', TRACKING.tight)}>
                <h3 className={classes(TYPE.body, WEIGHT.medium, COLOR.fg)}>Sign out?</h3>
                <p className={classes(TYPE.body, COLOR.muted, 'max-w-sm mx-auto leading-relaxed')}>
                  This wipes your local secret keys and creates a fresh anonymous identity. Export your key first if you want to log back in later.
                </p>
              </div>

              <div className={classes('flex', GAP[2], 'pt-2 max-w-sm mx-auto')}>
                <Button type="button" variant="secondary" onClick={() => setMode("export")} className="flex-1">
                  Export key first
                </Button>
                <Button type="button" variant="danger" onClick={handleConfirmLogout} className="flex-1">
                  Sign out
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
