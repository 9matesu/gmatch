'use client'

import { useRef, useState } from 'react'
import { Button, Modal } from '../ui/kit'

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
  return (
    <Modal title={title} onClose={onCancel} initialFocusRef={inputRef}>
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
        className="w-full bg-glass-w5 border border-edge rounded-lg px-3 py-2 text-xs font-mono text-retro-fg outline-none focus:border-retro-accent"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!value.trim()} onClick={() => onSubmit(value.trim())}>
          {submitLabel}
        </Button>
      </div>
    </Modal>
  )
}
