"use client";

import type { OrbitIdentity } from '@orbit/crypto';
import type { User } from '@orbit/shared';
import { StoreTab } from '../StoreTab';
import { HackSpyView } from '../hacks/HackSpyView';
import type { ActiveHackSession } from '../home/HomeFooter';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

/**
 * Hacks fused into PC Domination: the active spy session on top, the
 * buy/deploy arsenal below (StoreTab in arsenal-only mode — no packs,
 * no dashboard). Deploying keeps you here; expiry clears the session.
 */
export function HacksPanel({
  identity,
  users,
  profilePics = {},
  points,
  toast,
  activeHack,
  setActiveHack,
  onOpenFlash,
  onExitSpy,
}: {
  identity: OrbitIdentity | null;
  users: User[];
  profilePics?: Record<string, string>;
  points: number;
  toast: ToastFn;
  activeHack: ActiveHackSession | null;
  setActiveHack: React.Dispatch<React.SetStateAction<ActiveHackSession | null>>;
  onOpenFlash: () => void;
  onExitSpy: () => void;
}) {
  const expireHack = () => {
    setActiveHack(null);
    try { localStorage.removeItem('orbit_active_hack'); } catch { }
    toast('The spy session ran out of time.', 'info');
  };

  return (
    <div className="space-y-6">
      {activeHack ? (
        <HackSpyView
          session={activeHack}
          identity={identity}
          onBack={onExitSpy}
          onExpire={expireHack}
        />
      ) : (
        <div className="glass-panel p-4 rounded-xl border border-border-glass bg-surface-raised/40">
          <p className="text-xs text-retro-muted">
            No hack running. Buy one below to open a spy session on a player.
          </p>
        </div>
      )}

      <div>
        <h3 className="text-xs font-black uppercase tracking-wider text-retro-fg mb-3">Hacks</h3>
        <StoreTab
          arsenalOnly
          points={points}
          identity={identity}
          onOpenFlash={onOpenFlash}
          users={users}
          profilePics={profilePics}
          toast={toast}
          onDeployHack={(session) => {
            setActiveHack(session);
            try { localStorage.setItem('orbit_active_hack', JSON.stringify(session)); } catch { }
            toast(`Cyber hack deployed on ${session.targetUserName}!`, 'success');
          }}
        />
      </div>
    </div>
  );
}
