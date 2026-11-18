"use client";

import { useState } from 'react'
import { useGame } from '../../game/store'
import { isCustomMediaUrl } from '../../services/customSources'
import { MONO } from '../../ui/styles'
import { Modal, Button, Caption } from '../../ui/kit'
import {
  FolderSimple,
  Globe,
  LinkSimple,
  Plus,
  Trash,
} from '@phosphor-icons/react'

/**
 * Player-owned idle feed sources: pasted direct media URLs and/or
 * dialog-picked local folders (desktop app only). Custom sources are tried
 * before the built-in boorus and are used as-is — only add sources you
 * trust. Everything persists in the per-identity idle save.
 */
export default function CustomSourcesModal({ onClose }: { onClose: () => void }) {
  const sources = useGame((s) => s.customSources)
  const addUrlSource = useGame((s) => s.addUrlSource)
  const addFolderSource = useGame((s) => s.addFolderSource)
  const removeCustomSource = useGame((s) => s.removeCustomSource)
  const toggleCustomSource = useGame((s) => s.toggleCustomSource)
  const [label, setLabel] = useState('')
  const [urlsText, setUrlsText] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const canPickFolder = typeof window !== 'undefined' && Boolean(window.gmatch?.customPickFolder)
  const pasted = urlsText.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean)
  const usable = pasted.filter(isCustomMediaUrl)

  function submitUrls() {
    const r = addUrlSource(label, pasted)
    setNotice(r.message)
    if (r.added) {
      setLabel('')
      setUrlsText('')
    }
  }

  async function pickFolder() {
    if (!canPickFolder || picking) return
    setPicking(true)
    try {
      const res = await window.gmatch!.customPickFolder!()
      if (!res.ok || !res.id || !res.path) {
        if (res.error && res.error !== 'cancelled') setNotice(`Could not open that folder (${res.error}).`)
        return
      }
      const r = addFolderSource(res.id, res.path, label)
      setNotice(r.message)
      if (r.added) setLabel('')
    } finally {
      setPicking(false)
    }
  }

  return (
    <Modal title="Custom image sources" onClose={onClose} dismissable maxWidth="max-w-lg">
      <Caption>Tried before built-in feeds. Used as-is. Only add trusted sources.</Caption>

      <div className="max-h-[60vh] space-y-3 overflow-y-auto styled-scrollbar">
        {sources.length === 0 && (
          <p className="text-xs text-retro-muted italic py-2">No custom sources yet. Paste links or add a folder below.</p>
        )}
        {sources.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-lg border border-edge bg-glass-w8 px-3.5 py-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={s.enabled}
              aria-label={`${s.enabled ? 'Disable' : 'Enable'} ${s.label}`}
              onClick={() => toggleCustomSource(s.id)}
              className="relative flex h-5 w-9 shrink-0 cursor-pointer items-center border-0 p-0 rounded-full transition-colors"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-0 rounded-full transition-colors ${s.enabled ? 'bg-success/0' : 'bg-glass-w10'}`}
              />
              <span
                aria-hidden="true"
                className={`absolute left-0.5 h-4 w-4 rounded-full shadow-md transition-transform duration-150 ${s.enabled ? 'translate-x-4 bg-success' : 'translate-x-0 bg-glass-w20'}`}
              />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-retro-fg">{s.label}</div>
              <div className="truncate text-xs text-retro-muted flex items-center gap-1 mt-0.5">
                {s.kind === 'folder' ? (
                  <>
                    <FolderSimple size={12} weight="bold" className="text-retro-accent" />
                    <span>Folder · {s.folderPath ?? 'unlinked'}</span>
                  </>
                ) : (
                  <>
                    <LinkSimple size={12} weight="bold" className="text-retro-accent" />
                    <span>{s.urls.length} link{s.urls.length === 1 ? '' : 's'}</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeCustomSource(s.id)}
              aria-label={`Remove ${s.label}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-transparent text-retro-muted hover:text-retro-error hover:border-retro-error/30 hover:bg-retro-error/10 transition-all cursor-pointer"
            >
              <Trash size={14} weight="bold" />
            </button>
          </div>
        ))}

        <div className="space-y-2.5 rounded-lg border border-edge bg-glass-w8 p-3.5">
          <div className="text-xs font-semibold text-retro-fg flex items-center gap-1.5">
            <Globe size={13} weight="bold" className="text-retro-accent" />
            Add direct media links
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. My collection)"
            aria-label="Source label"
            className="w-full rounded-lg border border-edge bg-glass-w5 px-3 py-2 text-xs text-retro-fg outline-none placeholder:text-retro-muted focus:border-retro-accent transition-colors"
          />
          <textarea
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder={'Paste direct image/video links, one per line\nhttps://…/a.jpg\nhttps://…/b.mp4'}
            aria-label="Media links"
            rows={3}
            className="w-full rounded-lg border border-edge bg-glass-w5 px-3 py-2 text-xs text-retro-fg outline-none placeholder:text-retro-muted focus:border-retro-accent transition-colors"
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className={`${MONO} text-xs text-retro-muted`}>{usable.length} of {pasted.length} usable</span>
            <Button size="sm" onClick={submitUrls} disabled={usable.length === 0}>
              <Plus size={12} weight="bold" />
              Add links
            </Button>
          </div>
        </div>

        <div className="space-y-2.5 rounded-lg border border-edge bg-glass-w8 p-3.5">
          <div className="text-xs font-semibold text-retro-fg flex items-center gap-1.5">
            <FolderSimple size={13} weight="bold" className="text-retro-accent" />
            Add a local folder
          </div>
          {!canPickFolder && (
            <p className="text-xs text-retro-muted">Folder sources need the desktop app. Links work everywhere.</p>
          )}
          <Button size="sm" onClick={() => void pickFolder()} disabled={!canPickFolder || picking}>
            <FolderSimple size={13} weight="bold" />
            {picking ? 'Picking…' : 'Choose folder…'}
          </Button>
        </div>

        {notice && (
          <p className="rounded-lg border border-retro-accent/30 bg-retro-accent/10 px-3 py-2 text-xs text-retro-fg">
            {notice}
          </p>
        )}
      </div>
    </Modal>
  )
}
