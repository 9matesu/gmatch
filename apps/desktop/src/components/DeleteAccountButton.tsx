"use client";

import { useState } from 'react'
import { orbitFetch } from '../utils/api'
import type { OrbitIdentity } from '@orbit/crypto'
import { userFacingResponse, userFacingError } from '../utils/userError'

export function DeleteAccountButton({
  identity,
  onDeleted,
}: {
  identity: OrbitIdentity
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    setDeleting(true)
    setError('')
    try {
      const res = await orbitFetch('/api/users/account', { method: 'DELETE' }, identity)
      if (!res.ok) throw Object.assign(new Error(), { status: res.status })
      onDeleted()
    } catch (e: unknown) {
      setError(e instanceof Response ? userFacingResponse(e, 'Could not delete your account.') : userFacingError(e, { fallback: 'Could not delete your account.' }))
      setDeleting(false)
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs font-bold text-retro-muted hover:text-retro-error transition-colors"
      >
        Delete Account
      </button>
    )
  }

  return (
    <div className="bg-retro-bg border border-retro-error p-4 space-y-3">
      <p className="text-xs text-retro-error font-bold">Delete your account permanently?</p>
      <p className="text-[10px] text-retro-muted">
        This will delete your identity, profile, all uploaded images, and all associated data. This action cannot be undone.
      </p>
      {error && <p className="text-[10px] text-retro-error">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="bg-retro-panel text-white border border-retro-border px-4 py-2 text-xs font-bold hover:bg-surface-raised hover:text-retro-fg transition-colors disabled:opacity-30 cursor-pointer"
        >
          {deleting ? 'Deleting...' : 'Yes, Delete Everything'}
        </button>
        <button
          onClick={() => { setConfirming(false); setError('') }}
          className="px-3 py-2 text-xs font-bold text-retro-muted hover:text-retro-fg transition-colors"
          disabled={deleting}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
