"use client";

// Device-local mesh labels. A label is a group name for peers YOU keep track
// of on this machine: it adds no network, is discoverable by nobody, and
// confers no authority. It is deliberately NOT part of the server list — a
// label is not a server and must never look joinable. Hosting and joining live
// in AddWorldDialog; this is the secondary management flow for labels alone.
import { useEffect, useState } from 'react'
import { createLabel, isOwnLabel, type LocalMeshLabel } from './meshLabels'
import { Modal } from '../Modal'

export function GroupsDialog({
  open,
  labels,
  ownerId,
  onClose,
  onSave,
}: {
  open: boolean
  labels: LocalMeshLabel[]
  /** orbitId of the current identity; a label is owned by whoever made it. */
  ownerId?: string | null
  onClose: () => void
  onSave: (next: LocalMeshLabel[]) => void
}) {
  const [name, setName] = useState('')

  useEffect(() => { if (open) setName('') }, [open])

  if (!open) return null

  return (
    <Modal title="Local groups" onClose={onClose} maxWidth="max-w-sm">
      <div className="space-y-3">
        <p className="text-[10px] text-retro-muted">
          A label on this device for peers you keep track of. It adds no network and is
          visible to nobody else.
        </p>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const clean = name.trim()
            if (!clean) return
            onSave([...labels, createLabel(clean, ownerId || 'local-device')])
            setName('')
          }}
        >
          <label className="block flex-1 text-xs text-retro-muted">
            Group name
            <input
              aria-label="New group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Friday crew"
              maxLength={40}
              className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs"
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim()}
            className="glass-action glass-action-primary h-[30px] px-3 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            Create
          </button>
        </form>

        {labels.length === 0 ? (
          <p className="text-[10px] text-retro-muted">None yet.</p>
        ) : (
          <ul className="rounded-lg border border-border-glass divide-y divide-border-subtle overflow-hidden">
            {labels.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="truncate text-retro-fg">
                  {l.name}
                  <span className="ml-1 font-normal text-retro-muted">
                    · {l.memberOrbitIds.length} peers{l.nodeCodes.length ? ` · ${l.nodeCodes.length} codes` : ''}
                  </span>
                  {isOwnLabel(l, ownerId) && (
                    <span className="ml-1 text-[10px] text-retro-muted">(this device)</span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={`Forget group ${l.name}`}
                  title="Forget this group (local only, removes nothing remotely)"
                  onClick={() => onSave(labels.filter((x) => x.id !== l.id))}
                  className="px-1.5 py-0.5 rounded text-[10px] text-retro-muted hover:text-retro-error hover:bg-glass-w8 cursor-pointer transition-colors"
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
