"use client";

// Device-local mesh labels. A label is a group name for peers YOU keep track
// of on this machine: it adds no network, is discoverable by nobody, and
// confers no authority. It is deliberately NOT part of the server list — a
// label is not a server and must never look joinable. Hosting and joining live
// in AddWorldDialog; this is the secondary management flow for labels alone.
//
// Chrome drinks from ui/tokens: the kit Modal owns the shell, RECIPE.card the
// list surface, and TYPE/WEIGHT/STATUS the text and hover roles.
import { useEffect, useState } from 'react'
import { createLabel, isOwnLabel, type LocalMeshLabel } from './meshLabels'
import { Modal } from '../../ui/kit'
import {
  classes, COLOR, GAP, PADDING_X, PADDING_Y, RADIUS,
  RECIPE, STATUS, TRANSITION, TYPE, WEIGHT,
} from '../../ui/tokens'

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
        <p className={classes(TYPE.caption, COLOR.muted)}>
          A label on this device for peers you keep track of. It adds no network and is
          visible to nobody else.
        </p>

        <form
          className={classes('flex items-end', GAP[2])}
          onSubmit={(e) => {
            e.preventDefault()
            const clean = name.trim()
            if (!clean) return
            onSave([...labels, createLabel(clean, ownerId || 'local-device')])
            setName('')
          }}
        >
          <label className={classes('block flex-1', TYPE.body, COLOR.muted)}>
            Group name
            <input
              aria-label="New group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Friday crew"
              maxLength={40}
              className={classes('glass-field mt-1 w-full px-2.5 py-1.5', TYPE.body)}
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim()}
            className={classes('glass-action glass-action-primary h-[30px] cursor-pointer disabled:opacity-50', PADDING_X[3], RADIUS.control, TYPE.body, WEIGHT.bold)}
          >
            Create
          </button>
        </form>

        {labels.length === 0 ? (
          <p className={classes(TYPE.caption, COLOR.muted)}>None yet.</p>
        ) : (
          <ul className={classes('divide-y divide-edge-subtle overflow-hidden', RECIPE.card)}>
            {labels.map((l) => (
              <li key={l.id} className={classes('flex items-center justify-between', GAP[2], PADDING_X[3], PADDING_Y[2], TYPE.body)}>
                <span className={classes('truncate', COLOR.fg)}>
                  {l.name}
                  <span className={classes('ml-1', WEIGHT.regular, COLOR.muted)}>
                    · {l.memberOrbitIds.length} peers{l.nodeCodes.length ? ` · ${l.nodeCodes.length} codes` : ''}
                  </span>
                  {isOwnLabel(l, ownerId) && (
                    <span className={classes('ml-1', TYPE.caption, COLOR.muted)}>(this device)</span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={`Forget group ${l.name}`}
                  title="Forget this group (local only, removes nothing remotely)"
                  onClick={() => onSave(labels.filter((x) => x.id !== l.id))}
                  className={classes('px-1.5 py-0.5 cursor-pointer', RADIUS.chip, TYPE.caption, COLOR.muted, STATUS.danger, STATUS.dangerHoverBg, TRANSITION.micro)}
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
