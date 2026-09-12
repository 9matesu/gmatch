"use client";

import { useState, useRef, useEffect } from 'react'

interface SectionHelpButtonProps {
  title: string
  description: string
  onOpenFullHelp?: () => void
}

export function SectionHelpButton({ title, description, onOpenFullHelp }: SectionHelpButtonProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-5 h-5 flex items-center justify-center text-[10px] font-bold border border-border-glass text-retro-muted hover:text-retro-fg hover:border-retro-accent transition-colors"
        aria-label={`Help: ${title}`}
        title={`Help: ${title}`}
      >
        ?
      </button>

      {open && (
        <div className="absolute left-0 top-7 z-50 w-64 bg-retro-panel border border-border-glass p-3 space-y-2 animate-orbit-fade-in">
          <h4 className="text-xs font-bold text-retro-fg tracking-wider uppercase">{title}</h4>
          <p className="text-[10px] text-retro-muted leading-relaxed">{description}</p>
          {onOpenFullHelp && (
            <button
              type="button"
              onClick={() => { setOpen(false); onOpenFullHelp() }}
              className="text-[10px] font-bold text-retro-accent hover:underline transition-colors"
            >
              View full help guide →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
