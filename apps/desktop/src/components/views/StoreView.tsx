"use client";

// Extracted verbatim from App.tsx `mainView === 'store'` branch
// (behavior-preserving move; `handleSetMainView` threaded as `onSetMainView`).
import type { OrbitIdentity } from '@orbit/crypto';
import type { User } from '@orbit/shared';
import { StoreTab } from '../StoreTab';
import type { ActiveHackSession, MainViewType } from '../home/CommandIsland';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

export function StoreView({
  myUser,
  identity,
  users,
  profilePics,
  toast,
  onSetMainView,
  onOpenFlash,
  onSelectUser,
  setActiveHack,
}: {
  myUser: User | undefined;
  identity: OrbitIdentity | null;
  users: User[];
  profilePics: Record<string, string>;
  toast: ToastFn;
  onSetMainView: (view: MainViewType) => void;
  onOpenFlash: () => void;
  /** Open a profile from a card's owner credit on a market listing. */
  onSelectUser?: (userId: string) => void;
  setActiveHack: React.Dispatch<React.SetStateAction<ActiveHackSession | null>>;
}) {
  return (
    <div className="p-2 sm:p-6 max-w-5xl mx-auto w-full">
      <StoreTab
        points={myUser?.balance ?? 0}
        identity={identity}
        onOpenCardCollection={() => onSetMainView('gallery')}
        onOpenFlash={onOpenFlash}
        onOpenOwner={onSelectUser}
        users={users}
        profilePics={profilePics}
        toast={toast}
        onDeployHack={(session) => {
          setActiveHack(session);
          try { localStorage.setItem('orbit_active_hack', JSON.stringify(session)); } catch { }
          onSetMainView('pc_domination');
          toast(`Cyber hack deployed on ${session.targetUserName}.`, 'success');
        }}
      />
    </div>
  );
}
