"use client";

import { useState } from 'react'
import { useGame } from '../../game/store'
import { isCustomMediaUrl } from '../../services/customSources'
import { BTN, BTN_SMALL, MONO, MUTED } from '../../ui/styles'
import {
  FolderSimple,
  Globe,
  LinkSimple,
  Plus,
  Trash,
  X,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Custom image sources">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border-glass bg-retro-panel shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-border-glass p-4 bg-glass-w5">
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide">Custom image sources</h2>
            <p className="text-[11px] text-retro-muted mt-0.5">Tried before built-in feeds. Used as-is — only add trusted sources.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border-glass bg-glass-w5 text-retro-muted hover:text-white hover:bg-glass-w10 hover:border-border-strong transition-all cursor-pointer"
          >
            <X size={14} weight="bold" />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4 styled-scrollbar">
          {sources.length === 0 && (
            <p className="text-xs text-white/40 italic py-2">No custom sources yet — paste links or add a folder below.</p>
          )}
          {sources.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border-glass bg-glass-w8 px-3.5 py-2.5">
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
                  className={`absolute inset-0 rounded-full transition-colors ${s.enabled ? 'bg-emerald-500/40' : 'bg-glass-w10'}`}
                />
                <span
                  aria-hidden="true"
                  className={`absolute left-0.5 h-4 w-4 rounded-full shadow-md transition-transform duration-200 ${s.enabled ? 'translate-x-4 bg-emerald-400' : 'translate-x-0 bg-glass-w20'}`}
                />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-white">{s.label}</div>
                <div className="truncate text-[11px] text-white/40 flex items-center gap-1 mt-0.5">
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
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-transparent text-white/40 hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/10 transition-all cursor-pointer"
              >
                <Trash size={14} weight="bold" />
              </button>
            </div>
          ))}

          <div className="space-y-2.5 rounded-xl border border-border-glass bg-glass-w8 p-3.5">
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              <Globe size={13} weight="bold" className="text-retro-accent" />
              Add direct media links
            </div>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. My collection)"
              aria-label="Source label"
              className="w-full rounded-lg border border-border-glass bg-retro-bg px-3 py-2 text-xs text-white outline-none placeholder:text-retro-faint focus:border-retro-accent/60 transition-colors"
            />
            <textarea
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              placeholder={'Paste direct image/video links, one per line\nhttps://…/a.jpg\nhttps://…/b.mp4'}
              aria-label="Media links"
              rows={3}
              className="w-full rounded-lg border border-border-glass bg-retro-bg px-3 py-2 text-xs text-white outline-none placeholder:text-retro-faint focus:border-retro-accent/60 transition-colors"
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className={`${MONO} text-[11px] text-white/40`}>{usable.length} of {pasted.length} usable</span>
              <button
                type="button"
                onClick={submitUrls}
                disabled={usable.length === 0}
                className={`${BTN} ${BTN_SMALL} inline-flex items-center gap-1 disabled:opacity-40`}
              >
                <Plus size={12} weight="bold" />
                Add links
              </button>
            </div>
          </div>

          <div className="space-y-2.5 rounded-xl border border-border-glass bg-glass-w8 p-3.5">
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              <FolderSimple size={13} weight="bold" className="text-retro-accent" />
              Add a local folder
            </div>
            {!canPickFolder && (
              <p className="text-[11px] text-white/40">Folder sources need the desktop app — links work everywhere.</p>
            )}
            <button
              type="button"
              onClick={() => void pickFolder()}
              disabled={!canPickFolder || picking}
              className={`${BTN} ${BTN_SMALL} inline-flex items-center gap-1.5 disabled:opacity-40`}
            >
              <FolderSimple size={13} weight="bold" />
              {picking ? 'Picking…' : 'Choose folder…'}
            </button>
          </div>

          {notice && (
            <p className="rounded-lg border border-retro-accent/30 bg-retro-accent/10 px-3 py-2 text-xs text-retro-fg">
              {notice}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
