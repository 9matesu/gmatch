'use client'

import { useEffect, useRef, useState } from 'react'

// In-app prompt. Electron does NOT implement window.prompt (it returns null),
// so every "ask the user for a string" flow in the .exe must come through here.
export function PromptDialog({
  title,
  description,
  placeholder = '',
  submitLabel = 'Confirm',
  onSubmit,
  onCancel,
}: {
  title: string
  description?: string
  placeholder?: string
  submitLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/70 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="glass-panel w-full max-w-sm rounded-xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <h3 className="text-sm font-bold text-retro-fg">{title}</h3>
        {description && <p className="text-xs text-retro-muted">{description}</p>}
        <input
          ref={inputRef}
          aria-label={title}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) onSubmit(value.trim())
          }}
          className="glass-field w-full px-3 py-2 text-xs font-mono"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="glass-action rounded-lg px-3 py-1.5 text-xs text-retro-muted hover:text-retro-fg cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!value.trim()}
            onClick={() => onSubmit(value.trim())}
            className="glass-action glass-action-primary rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
