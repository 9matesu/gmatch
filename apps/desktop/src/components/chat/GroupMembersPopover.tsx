"use client";

import { useCallback, useEffect, useState } from 'react'
import { playPress } from '../../utils/sounds'
import { RefreshCw, UserPlus, Crown } from 'lucide-react'

export interface GroupMember {
  id: string
  display_name: string
  is_owner: number
}

/**
 * Group members panel (UI-7): lists the members of a chat group, and for the
 * owner offers adding peers. Data comes from GET /api/groups/:id/members;
 * parent supplies loaders/mutators so one App-level fetch cache serves all
 * mounts (sidebar panel + Messages page).
 */
export function GroupMembersPopover({
  groupId,
  loadMembers,
  meId,
  isOwner = false,
  peers = [],
  onAddMembers,
}: {
  groupId: string
  loadMembers: (groupId: string) => Promise<GroupMember[]>
  meId?: string
  isOwner?: boolean
  peers?: Array<{ orbitId: string; name: string }>
  onAddMembers?: (groupId: string, ids: string[]) => Promise<boolean> | void
}) {
  const [members, setMembers] = useState<GroupMember[] | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  const fetchMembers = useCallback(async () => {
    setError(false)
    setMembers(null)
    try {
      const list = await loadMembers(groupId)
      setMembers(list)
    } catch {
      setError(true)
    }
  }, [groupId, loadMembers])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  const memberIds = new Set((members || []).map((m) => m.id))
  const nonMemberPeers = peers.filter((p) => !memberIds.has(p.orbitId))

  if (error) {
    return (
      <div className="p-3 text-xs text-retro-muted">
        Could not load members.{' '}
        <button type="button" className="text-retro-accent underline cursor-pointer" onClick={() => void fetchMembers()}>
          <RefreshCw className="w-3 h-3 inline" /> Retry
        </button>
      </div>
    )
  }
  if (!members) {
    return <div className="p-3 text-xs text-retro-muted animate-pulse">Loading members…</div>
  }

  async function confirmAdd(ids: string[]) {
    if (!onAddMembers || ids.length === 0) return
    setAdding(true)
    const ok = await onAddMembers(groupId, ids)
    setAdding(false)
    setSelected(new Set())
    if (ok !== false) void fetchMembers()
  }

  return (
    <div className="p-2 space-y-1" role="list" aria-label="Group members">
      {members.map((m) => (
        <div key={m.id} role="listitem" className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs">
          <span className="w-6 h-6 rounded-full bg-surface-raised border border-border-glass flex items-center justify-center text-[10px] font-bold text-retro-muted shrink-0">
            {m.display_name.charAt(0).toUpperCase()}
          </span>
          <span className="truncate text-retro-body">
            {m.display_name}
            {m.id === meId && <span className="text-retro-muted"> (you)</span>}
          </span>
          {m.is_owner === 1 && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-400 shrink-0">
              <Crown className="w-3 h-3" /> owner
            </span>
          )}
        </div>
      ))}

      {isOwner && nonMemberPeers.length > 0 && (
        <div className="pt-2 border-t border-border-glass mt-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-retro-muted px-2">Add people</div>
          {nonMemberPeers.map((p) => (
            <button
              key={p.orbitId}
              type="button"
              role="button"
              onClick={() => {
                playPress(700)
                setSelected((prev) => {
                  const next = new Set(prev)
                  if (next.has(p.orbitId)) next.delete(p.orbitId)
                  else next.add(p.orbitId)
                  return next
                })
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                selected.has(p.orbitId) ? 'bg-retro-accent/15 text-retro-fg border border-retro-accent/40' : 'hover:bg-glass-w5 text-retro-body border border-transparent'
              }`}
            >
              <UserPlus className={`w-3.5 h-3.5 shrink-0 ${selected.has(p.orbitId) ? 'text-retro-accent' : 'text-retro-muted'}`} />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => void confirmAdd(Array.from(selected))}
              disabled={adding}
              className="w-full mt-1 px-3 py-1.5 rounded-md bg-retro-accent text-black text-[11px] font-bold cursor-pointer disabled:opacity-50"
            >
              {adding ? 'Adding…' : `Add ${selected.size} to group`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
