"use client";

import { useState } from 'react'
import { useGame } from '../../game/store'
import { isCustomMediaUrl } from '../../services/customSources'
import { BTN, BTN_SMALL, MUTED } from '../../ui/styles'
import { IconX } from '../../ui/icons'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Custom image sources">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border-glass bg-surface-canvas shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-border-glass p-4">
          <div>
            <h2 className="text-sm font-bold text-retro-fg">Custom image sources</h2>
            <p className={MUTED}>Tried before the built-in feeds. Used as-is — only add sources you trust.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="glass-button rounded-lg p-1.5 cursor-pointer">
            <IconX size={14} />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4 styled-scrollbar">
          {sources.length === 0 && (
            <p className={MUTED}>No custom sources yet — paste links or add a folder below.</p>
          )}
          {sources.map((s) => (
            <div key={s.id} className="flex items-center gap-2.5 rounded-xl border border-border-glass bg-surface-raised px-3 py-2">
              <button
                type="button"
                role="switch"
                aria-checked={s.enabled}
                aria-label={`${s.enabled ? 'Disable' : 'Enable'} ${s.label}`}
                onClick={() => toggleCustomSource(s.id)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer ${s.enabled ? 'bg-retro-accent' : 'bg-white/10'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${s.enabled ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-retro-fg">{s.label}</div>
                <div className={`${MUTED} truncate`}>
                  {s.kind === 'folder'
                    ? `Folder · ${s.folderPath ?? 'unlinked'}`
                    : `${s.urls.length} link${s.urls.length === 1 ? '' : 's'}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeCustomSource(s.id)}
                aria-label={`Remove ${s.label}`}
                className="shrink-0 rounded-lg p-1.5 text-retro-muted hover:text-rose-400 transition-colors cursor-pointer"
              >
                <IconX size={13} />
              </button>
            </div>
          ))}

          <div className="space-y-2 rounded-xl border border-border-glass bg-surface-raised p-3">
            <div className="text-xs font-bold text-retro-fg">Add links</div>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. My collection)"
              aria-label="Source label"
              className="w-full rounded-lg border border-border-glass bg-retro-bg px-2.5 py-1.5 text-xs text-retro-fg outline-none placeholder:text-retro-muted focus:border-retro-accent"
            />
            <textarea
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              placeholder={'Paste direct image/video links, one per line\nhttps://…/a.jpg\nhttps://…/b.mp4'}
              aria-label="Media links"
              rows={3}
              className="w-full rounded-lg border border-border-glass bg-retro-bg px-2.5 py-1.5 text-xs text-retro-fg outline-none placeholder:text-retro-muted focus:border-retro-accent"
            />
            <div className="flex items-center justify-between gap-2">
              <span className={MUTED}>{usable.length} of {pasted.length} usable</span>
              <button type="button" onClick={submitUrls} disabled={usable.length === 0} className={`${BTN} ${BTN_SMALL} disabled:opacity-40`}>
                Add links
              </button>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-border-glass bg-surface-raised p-3">
            <div className="text-xs font-bold text-retro-fg">Add a local folder</div>
            {!canPickFolder && (
              <p className={MUTED}>Folder sources need the desktop app — links work everywhere.</p>
            )}
            <button type="button" onClick={() => void pickFolder()} disabled={!canPickFolder || picking} className={`${BTN} ${BTN_SMALL} disabled:opacity-40`}>
              {picking ? 'Picking…' : 'Choose folder…'}
            </button>
          </div>

          {notice && <p className="text-[11px] text-retro-body">{notice}</p>}
        </div>
      </div>
    </div>
  )
}
