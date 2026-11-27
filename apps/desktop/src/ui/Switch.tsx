import { memo } from 'react'

/**
 * Pill switch: one rounded track + one round knob.
 * role="switch", aria-checked, onClick. Colour and elevation come from tokens.
 */
export const Switch = memo(function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean
  onChange: () => void
  label?: string
  id?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-retro-accent"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-full transition-colors ${checked ? 'bg-retro-accent' : 'bg-surface-interactive'
          }`}
      />
      <span
        aria-hidden="true"
        className={`absolute left-0.5 h-4 w-4 rounded-full shadow-sm transition-transform ${checked ? 'translate-x-4 bg-retro-accent-text' : 'translate-x-0 bg-retro-muted'
          }`}
      />
    </button>
  )
})
