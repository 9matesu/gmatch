"use client";

// Extracted verbatim from App.tsx `mainView === 'hack_spy' && activeHack` branch
// (`handleSetMainView` threaded as `onSetMainView`).
import type { OrbitIdentity } from '@orbit/crypto';
import { HackSpyView } from '../hacks/HackSpyView';
import type { ActiveHackSession, MainViewType } from '../home/HomeFooter';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

export function HackSpyTabView({
  activeHack,
  identity,
  toast,
  onSetMainView,
  setActiveHack,
}: {
  activeHack: ActiveHackSession;
  identity: OrbitIdentity | null;
  toast: ToastFn;
  onSetMainView: (view: MainViewType) => void;
  setActiveHack: React.Dispatch<React.SetStateAction<ActiveHackSession | null>>;
}) {
  return (
    <div className="w-full flex-1 flex flex-col items-center justify-start p-2 sm:p-6">
      <HackSpyView
        session={activeHack}
        identity={identity}
        onBack={() => onSetMainView('feed')}
        onExpire={() => {
          setActiveHack(null);
          try { localStorage.removeItem('orbit_active_hack'); } catch { }
          onSetMainView('feed');
          toast('Active cyber hack payload expired', 'info');
        }}
      />
    </div>
  );
}
