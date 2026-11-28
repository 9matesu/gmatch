"use client";

import { useEffect, useState } from 'react';
import { Check, Copy, Network, RefreshCw } from 'lucide-react';
import { findRadminVpn, joinRadminVlan, radminAdapterIp, type RadminJoinResult } from '../../services/radmin';
import { retryPeerConnections } from '../../hooks/useP2P';

/** The shared Radmin VLAN every player joins to share one virtual LAN. */
export const RADMIN_VLAN_NAME = 'gMatch Official VLAN';
export const RADMIN_VLAN_PASSWORD = 'GMATCHVLAN';

type Toast = (msg: string, type?: 'error' | 'success' | 'info' | 'warning' | any) => void;

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs text-retro-muted">{label}</div>
        <div className="font-mono text-xs text-retro-fg break-all select-all">{value}</div>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="px-2.5 py-1.5 bg-glass-w8 hover:bg-glass-w12 border border-edge text-retro-fg rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

/**
 * Settings → Networking: connectivity that really repairs.
 *
 * Radmin VPN gives two peers on the same virtual LAN a real direct path (a
 * 26.x host candidate is signaled — see utils/ice-hygiene.ts). This section
 * shows the shared VLAN credentials, joins it with a REAL outcome (joined only
 * when a 26.x adapter actually appears), shows the detected Radmin IP, and can
 * re-issue one bounded direct attempt per cross-node peer.
 */
export function NetworkSection({ toast }: { toast?: Toast }) {
  const [radminIp, setRadminIp] = useState<string | null>(null);
  const [exeFound, setExeFound] = useState<boolean | null>(null);
  const [joining, setJoining] = useState(false);
  const [lastResult, setLastResult] = useState<RadminJoinResult | null>(null);

  const refreshAdapter = () => {
    void radminAdapterIp().then((ip) => setRadminIp(ip));
    void findRadminVpn().then((p) => setExeFound(!!p));
  };

  useEffect(refreshAdapter, []);

  const join = async () => {
    setJoining(true);
    setLastResult(null);
    try {
      const res = await joinRadminVlan(RADMIN_VLAN_NAME, RADMIN_VLAN_PASSWORD);
      setLastResult(res);
      if (res.status === 'joined') {
        setRadminIp(res.ip ?? null);
        toast?.(`Joined Radmin VLAN — adapter ${res.ip}`, 'success');
      } else {
        toast?.(`Could not join Radmin VLAN: ${res.reason}`, 'error');
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unexpected error';
      setLastResult({ status: 'failed', reason });
      toast?.(`Could not join Radmin VLAN: ${reason}`, 'error');
    } finally {
      setJoining(false);
    }
  };

  const retryPeers = () => {
    const ok = retryPeerConnections();
    toast?.(
      ok ? 'Re-announced presence and retrying peer connections' : 'No live peer connection to retry (sign in first)',
      ok ? 'success' : 'info',
    );
  };

  return (
    <section className="p-4 bg-glass-w5 border border-edge rounded-lg space-y-4">
      <h4 className="text-xs font-medium text-retro-fg flex items-center gap-2">
        <Network className="w-4 h-4 text-retro-accent" /> Radmin VPN
      </h4>
      <p className="text-xs text-retro-muted">
        Join the shared Radmin VLAN to get a direct peer-to-peer path. Credentials are public — everyone
        in the community uses the same network.
      </p>

      <div className="space-y-2">
        <CopyField label="VLAN name" value={RADMIN_VLAN_NAME} />
        <CopyField label="Password" value={RADMIN_VLAN_PASSWORD} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={join}
          disabled={joining}
          className="px-3.5 py-2 bg-retro-accent hover:bg-retro-accent-hover disabled:opacity-40 text-retro-accent-text rounded-lg text-xs font-semibold cursor-pointer shrink-0 active:scale-(--scale-press) transition-colors"
        >
          {joining ? 'Joining…' : 'Join Radmin VLAN'}
        </button>
        <button
          type="button"
          onClick={retryPeers}
          className="px-3.5 py-2 bg-glass-w8 hover:bg-glass-w12 border border-edge text-retro-fg rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors active:scale-(--scale-press)"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry peer connections
        </button>
      </div>

      <div className="text-xs text-retro-muted space-y-1">
        <div>
          Detected Radmin IP:{' '}
          <span className="font-mono text-retro-fg">{radminIp ?? 'none (not joined)'}</span>
        </div>
        {exeFound === false && (
          <div className="text-retro-error">Radmin VPN is not installed on this device.</div>
        )}
        {lastResult?.status === 'failed' && (
          <div className="text-retro-error">Last join attempt: {lastResult.reason}</div>
        )}
        {lastResult?.status === 'joined' && (
          <div className="text-retro-online">Joined — adapter {lastResult.ip}</div>
        )}
      </div>
    </section>
  );
}