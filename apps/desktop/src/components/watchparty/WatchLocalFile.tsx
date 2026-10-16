'use client'

// Local-file entry for Watch Party rooms: pick or drop a video file, see its
// metadata + integrity hash, then explicitly share it with the room.
//
// Nothing leaves the machine before the Share press: hashing and the preview
// are local. Sharing registers metadata and seeds swarm bytes for CURRENT
// room members only — a late joiner is not covered and the host re-shares.

import { useRef, useState } from 'react'
import { FileVideo, Upload } from 'lucide-react'
import { classifyLocalFile } from '@orbit/shared'
import { BTN_PRIMARY, MUTED } from '../../ui/styles'
import {
  describeLocalFile,
  formatBytes,
  markVerified,
  shareLocalFile,
  type LocalFileMeta,
} from '../../hooks/watchLocalShare'
import {
  createPartyFromLocal,
  type PartyRuntime,
} from '../../hooks/watchPartyStore'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export function WatchLocalFile({
  identity,
  party,
  roomName,
  queueMode,
  onDone,
}: {
  identity: IdentityLike
  /** Null in create mode: sharing creates the room. */
  party: PartyRuntime | null
  roomName: string
  /** Queue without interrupting playback (in-room). */
  queueMode: boolean
  onDone: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState<LocalFileMeta | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const pick = async (f: File | null) => {
    if (!f) return
    const hint = classifyLocalFile({ name: f.name, type: f.type })
    if (!hint.ok) {
      setFile(null)
      setMeta(null)
      setError(hint.reason || 'That file is not a playable video.')
      return
    }
    setError('')
    setFile(f)
    setStatus('Reading file metadata…')
    try {
      setMeta(await describeLocalFile(f))
      setStatus('')
    } catch (err) {
      setMeta(null)
      setError(err instanceof Error ? err.message : 'Could not read that file.')
      setStatus('')
    }
  }

  const share = async () => {
    if (!file || !meta || busy || !consent) return
    setBusy(true)
    setError('')
    try {
      if (!party) {
        // Create mode: forge + register first (consent), then seed the room.
        const { forgeMediaLocally } = await import('../../services/mediaForge')
        setStatus('Registering shared file…')
        const forged = await forgeMediaLocally(file, identity as never, {
          caption: meta.name,
          isPublic: false,
          isChat: true,
        })
        markVerified(forged.id, meta.hash)
        setStatus('Starting party…')
        const res = await createPartyFromLocal(
          identity,
          { objectId: forged.id, name: meta.name, hash: meta.hash, size: meta.size },
          roomName.trim(),
        )
        if (!res.ok) {
          setError(res.error || 'Could not start the party.')
          setBusy(false)
          setStatus('')
          return
        }
      } else {
        setStatus('Registering shared file…')
        const res = await shareLocalFile(identity, party, file, meta, { playNow: !queueMode })
        if (!res.ok) {
          setError(res.error || 'Could not share that file.')
          setBusy(false)
          setStatus('')
          return
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share that file.')
      setBusy(false)
      setStatus('')
      return
    }
    setBusy(false)
    setStatus('')
    onDone()
  }

  return (
    <div className="space-y-2.5">
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/ogg,video/*"
        className="hidden"
        aria-label="Choose a local video file"
        onChange={(e) => void pick(e.target.files?.[0] || null)}
      />
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a local video file here, or activate to browse"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void pick(e.dataTransfer.files?.[0] || null)
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-4 text-center transition-colors ${
          dragOver ? 'border-retro-fg bg-glass-w10' : 'border-border-glass hover:border-retro-fg/50'
        }`}
      >
        <FileVideo className="h-5 w-5 text-retro-muted" />
        <p className="text-xs text-retro-fg">Drop a video file here, or browse</p>
        <p className={`text-[10px] ${MUTED}`}>MP4, WebM, MOV and other files your browser can play</p>
      </div>

      {meta && file && (
        <div className="rounded-lg border border-border-glass bg-glass-w5 px-3 py-2 text-xs">
          <p className="truncate font-semibold text-retro-fg">{meta.name}</p>
          <p className={`mt-0.5 font-mono text-[10px] ${MUTED}`}>
            {formatBytes(meta.size)}
            {meta.duration !== null && Number.isFinite(meta.duration) ? ` · ${Math.round(meta.duration)}s` : ''}
            {` · sha256:${meta.hash.slice(0, 12)}…`}
          </p>
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] text-retro-muted">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Share this file with {party ? 'the room' : 'the new room'}. Bytes go directly to current members —
              never to the server. Late joiners need a re-share.
            </span>
          </label>
        </div>
      )}

      {status && <p className="text-xs text-retro-muted">{status}</p>}
      {error && <p className="text-xs text-retro-error">{error}</p>}

      <button
        type="button"
        onClick={() => void share()}
        disabled={!file || !meta || !consent || busy}
        className={`${BTN_PRIMARY} flex w-full items-center justify-center gap-2 py-2 text-xs disabled:opacity-40`}
      >
        <Upload className="h-3.5 w-3.5" />
        {busy ? status || 'Sharing…' : party ? 'Share with room' : 'Share and start party'}
      </button>
    </div>
  )
}
