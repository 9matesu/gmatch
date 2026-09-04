"use client";

// Extracted verbatim from App.tsx `mainView === 'pc_domination'` branch.
import type { OrbitIdentity } from '@orbit/crypto';
import type { User } from '@orbit/shared';
import { PCDominationTab } from '../domination/PCDominationTab';

export function PCDominationView({
  identity,
  users,
}: {
  identity: OrbitIdentity | null;
  users: User[];
}) {
  return (
    <div className="w-full flex-1 flex flex-col items-center justify-start p-2 sm:p-6">
      <PCDominationTab
        identity={identity}
        users={users.map(u => ({ id: u.id, orbitId: u.id, display_name: u.display_name || '', pfp_url: u.pfp_url }))}
      />
    </div>
  );
}
