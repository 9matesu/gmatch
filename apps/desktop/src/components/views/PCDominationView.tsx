"use client";

// Extracted verbatim from App.tsx `mainView === 'pc_domination'` branch.
// Now also hosts the fused cyber-hack arsenal + live spy feed (Hacks tab).
import type { OrbitIdentity } from '@orbit/crypto';
import type { User } from '@orbit/shared';
import { PCDominationTab } from '../domination/PCDominationTab';
import type { ActiveHackSession } from '../home/HomeFooter';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

export function PCDominationView({
  identity,
  users,
  profilePics,
  points,
  toast,
  activeHack,
  setActiveHack,
  onOpenFlash,
}: {
  identity: OrbitIdentity | null;
  users: User[];
  profilePics: Record<string, string>;
  points: number;
  toast: ToastFn;
  activeHack: ActiveHackSession | null;
  setActiveHack: React.Dispatch<React.SetStateAction<ActiveHackSession | null>>;
  onOpenFlash: () => void;
}) {
  return (
    <div className="w-full flex-1 flex flex-col items-center justify-start p-2 sm:p-6">
      <PCDominationTab
        identity={identity}
        users={users.map(u => ({ id: u.id, orbitId: u.id, display_name: u.display_name || '', pfp_url: u.pfp_url }))}
        allUsers={users}
        profilePics={profilePics}
        points={points}
        toast={toast}
        activeHack={activeHack}
        setActiveHack={setActiveHack}
        onOpenFlash={onOpenFlash}
      />
    </div>
  );
}
