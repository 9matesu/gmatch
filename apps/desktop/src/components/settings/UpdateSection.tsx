"use client";

// E3 update check (ponytail): the connected server already hosts release.json
// next to the download once gmatch.fly.dev serves the site — no new API.
// Compares versions numerically and links straight to the .exe. No
// in-app auto-install: verify-the-hash before running is the contract.
import { useState } from 'react';
import { Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { getApiBaseUrl } from '../../utils/api';
import { isNewer } from '../../utils/version';
import { playPress } from '../../utils/sounds';

interface ReleaseMeta {
  file: string;
  version: string;
  sha256: string;
  buildDate?: string;
}

export function UpdateSection({ toast }: {
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const [installed, setInstalled] = useState<string | null>(null);
  const [latest, setLatest] = useState<ReleaseMeta | null>(null);
  const [checking, setChecking] = useState(false);

  const bridge = window.gmatch;
  if (!bridge?.appVersion) return null;

  const check = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const cur = await bridge.appVersion!();
      setInstalled(cur);
      const res = await fetch(`${getApiBaseUrl().replace(/\/+$/, '')}/release.json`, { cache: 'no-store' });
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

  const hasUpdate = Boolean(installed && latest && isNewer(latest.version, installed));

  return (
    <div className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h4 className="text-xs font-medium text-retro-fg">Updates</h4>
          <p className="text-[11px] text-retro-muted">
            Installed: <span className="font-mono">{installed ?? '…'}</span>
            {latest && <> · Latest: <span className="font-mono">{latest.version}</span>{latest.buildDate && <> · built {latest.buildDate.slice(0, 10)}</>}</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasUpdate && bridge.openExternal && latest && (
            <button
              type="button"
              onClick={() => {
                playPress(820);
                void bridge.openExternal!(new URL(`/releases/${latest.file}`, getApiBaseUrl()).href);
              }}
              className="px-3 py-1.5 rounded-lg bg-retro-accent text-black text-[11px] font-bold cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Download {latest.version}
            </button>
          )}
          <button
            type="button"
            disabled={checking}
            onClick={() => { playPress(700); void check(); }}
            className="px-3 py-1.5 rounded-lg border border-border-glass text-[11px] text-retro-muted hover:text-retro-fg disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> {checking ? 'Checking…' : 'Check for update'}
          </button>
        </div>
      </div>
      {hasUpdate && (
        <p className="text-[10px] text-retro-muted flex items-start gap-1.5">
          <ShieldCheck className="w-3 h-3 shrink-0 mt-px" />
          Verify before running: <code className="font-mono break-all">SHA-256 {latest?.sha256}</code> — in
          PowerShell: <code className="font-mono">Get-FileHash $env:USERPROFILE\Downloads\{latest?.file} -Algorithm SHA256</code>
        </p>
      )}
    </div>
  );
}
