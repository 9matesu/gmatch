"use client";

// Updates (Settings). Packaged builds drive the portable self-update in the
// main process (GitHub Releases -> auto-download -> "Install & Restart" swaps
// this very .exe and relaunches). Dev/browser builds fall back to the old
// release.json check that links straight to the download.
import { useEffect, useState } from 'react';
import { Download, RefreshCw, ShieldCheck, ShieldAlert, Rocket, Sparkles } from 'lucide-react';
import { getApiBaseUrl } from '../../utils/api';
import { isNewer } from '../../utils/version';
import { playPress } from '../../utils/sounds';
import type { GmatchUpdateStatus } from '../../types/gmatch-bridge';

interface ReleaseMeta {
  file: string;
  version: string;
  sha256: string;
  buildDate?: string;
}

const RELEASES_URL = 'https://github.com/9matesu/goongrid/releases/latest';

export function UpdateSection({ toast }: {
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const bridge = window.gmatch;
  const updater = Boolean(bridge?.updateCheck && bridge?.onUpdateStatus);
  const [installed, setInstalled] = useState<string | null>('1.5.1');
  const [status, setStatus] = useState<GmatchUpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  // legacy fallback state (browser/dev without the updater bridge)
  const [latest, setLatest] = useState<ReleaseMeta | null>(null);

  useEffect(() => {
    if (!bridge?.appVersion) return;
    void bridge.appVersion().then(setInstalled).catch(() => {});
  }, [bridge]);

  useEffect(() => {
    if (!updater || !bridge?.updateState || !bridge.onUpdateStatus) return;
    void bridge.updateState().then(setStatus).catch(() => {});
    return bridge.onUpdateStatus(setStatus);
  }, [updater, bridge]);

  const phase = status?.phase ?? 'idle';
  const busy = checking || phase === 'checking';
  const downloadPct = phase === 'downloading' ? Math.max(0, Math.min(100, status?.percent ?? 0)) : 0;

  const check = async () => {
    if (busy || !bridge?.updateCheck) return;
    setChecking(true);
    try {
      const s = await bridge.updateCheck();
      setStatus(s);
      if (s.phase === 'current') toast?.('You are on the latest version', 'success');
      if (s.phase === 'error') toast?.(s.error || 'Could not check for updates', 'error');
    } catch {
      toast?.('Could not check for updates', 'error');
    } finally {
      setChecking(false);
    }
  };

  const checkFallback = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const cur = bridge?.appVersion ? await bridge.appVersion() : (installed || '1.5.1');
      setInstalled(cur);
      const base = getApiBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : 'https://gmatch-wcz1.onrender.com');
      const res = await fetch(`${base.replace(/\/+$/, '')}/release.json`, { cache: 'no-store' });
      if (!res.ok) { toast?.('Update server has no release.json yet', 'warning'); return; }
      const meta = (await res.json()) as ReleaseMeta;
      setLatest(meta);
      if (isNewer(meta.version, cur)) toast?.(`gMatch ${meta.version} is available`, 'info');
      else toast?.('You are on the latest version', 'success');
    } catch {
      toast?.('Could not check for updates', 'error');
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    if (!bridge?.updateInstall || installing) return;
    if (!window.confirm(`Install gMatch ${status?.version ?? ''} now? The app closes and reopens updated.`)) return;
    setInstalling(true);
    try {
      const res = await bridge.updateInstall();
      if (!res.ok) { toast?.(res.error || 'Could not start the update', 'error'); setInstalling(false); }
      // On success the process dies; no state to clean up.
    } catch (err) {
      toast?.(String((err as Error)?.message || err), 'error');
      setInstalling(false);
    }
  };

  const openReleases = () => {
    playPress(820);
    if (bridge?.openExternal) void bridge.openExternal(RELEASES_URL);
    else if (typeof window !== 'undefined') window.open(RELEASES_URL, '_blank');
  };

  const hasUpdateFallback = Boolean(installed && latest && isNewer(latest.version, installed));

  return (
    <div className="p-4 bg-surface-interactive border border-border-glass rounded-lg space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h4 className="text-xs font-medium text-retro-fg">Updates</h4>
          <p className="text-xs text-retro-muted">
            Installed: <span className="font-mono">{installed ?? '…'}</span>
            {updater && phase === 'current' && status?.latest && <> · latest <span className="font-mono">{status.latest}</span></>}
            {updater && ['available', 'downloading', 'ready'].includes(phase) && status?.version && (
              <> · update <span className="font-mono">{status.version}</span></>
            )}
            {!updater && latest && <> · Latest: <span className="font-mono">{latest.version}</span>{latest.buildDate && <> · built {latest.buildDate.slice(0, 10)}</>}</>}
          </p>
          {updater && phase === 'downloading' && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-black/40" role="progressbar" aria-valuenow={downloadPct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-retro-accent transition-[width]" style={{ width: `${downloadPct}%` }} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {updater && phase === 'ready' ? (
            <button
              type="button"
              disabled={installing}
              onClick={() => { playPress(900); void install(); }}
              className="px-3 py-1.5 rounded-lg bg-retro-accent text-black text-xs font-bold cursor-pointer flex items-center gap-1.5"
            >
              <Rocket className="w-3.5 h-3.5" /> {installing ? 'Restarting…' : `Install & Restart`}
            </button>
          ) : !updater && hasUpdateFallback && latest ? (
            <button
              type="button"
              onClick={() => {
                playPress(820);
                const base = getApiBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : 'https://gmatch-wcz1.onrender.com');
                const url = new URL(`/releases/${latest.file}`, base).href;
                if (bridge?.openExternal) void bridge.openExternal(url);
                else if (typeof window !== 'undefined') window.open(url, '_blank');
              }}
              className="px-3 py-1.5 rounded-lg bg-retro-accent text-black text-xs font-bold cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Download {latest.version}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => { playPress(700); void (updater ? check() : checkFallback()); }}
            className="px-3 py-1.5 rounded-lg border border-border-glass text-xs text-retro-muted hover:text-retro-fg disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Checking…' : 'Check for updates'}
          </button>
          <button
            type="button"
            onClick={() => {
              playPress(700);
              window.dispatchEvent(new CustomEvent('gmatch-open-changelog'));
            }}
            className="px-3 py-1.5 rounded-lg border border-border-glass text-xs text-retro-muted hover:text-retro-fg cursor-pointer flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-retro-accent" /> What&apos;s New
          </button>
        </div>
      </div>
      {updater && phase === 'error' && (
        <div className="flex items-start justify-between gap-3 text-[10px] text-retro-muted">
          <p className="flex items-start gap-1.5 min-w-0">
            <ShieldAlert className="w-3 h-3 shrink-0 mt-px text-amber-400" />
            <span className="break-words">{status?.error || 'Update failed'}. You can grab the .exe manually.</span>
          </p>
          <button type="button" onClick={openReleases} className="shrink-0 underline hover:text-retro-fg cursor-pointer">
            GitHub releases
          </button>
        </div>
      )}
      {updater && phase === 'ready' && (
        <p className="text-[10px] text-retro-muted flex items-start gap-1.5">
          {status?.verified ? <ShieldCheck className="w-3 h-3 shrink-0 mt-px text-emerald-400" /> : <ShieldCheck className="w-3 h-3 shrink-0 mt-px text-amber-400" />}
          {status?.verified
            ? 'Download verified (SHA-256 matches the release digest).'
            : 'SHA-256 digest was not published on this release. The file comes straight from the repo, unverified.'}
        </p>
      )}
      {!updater && hasUpdateFallback && (
        <p className="text-[10px] text-retro-muted flex items-start gap-1.5">
          <ShieldCheck className="w-3 h-3 shrink-0 mt-px" />
          Verify before running: <code className="font-mono break-all">SHA-256 {latest?.sha256}</code>. In
          PowerShell: <code className="font-mono">Get-FileHash $env:USERPROFILE\Downloads\{latest?.file} -Algorithm SHA256</code>
        </p>
      )}
    </div>
  );
}
