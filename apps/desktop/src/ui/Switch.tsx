import { memo } from 'react'

/**
 * Thin horizontal track switch: w-9 line (h-1) + floating h-3 w-3 knob.
 * role="switch", aria-checked, onClick.
 */
export const Switch = memo(function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: () => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="relative flex h-4 w-9 shrink-0 cursor-pointer items-center border-0 p-0"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 h-1 rounded-full transition-colors ${checked ? 'bg-retro-accent/50' : 'bg-surface-interactive'
          }`}
      />
      <span
        aria-hidden="true"
        className={`absolute left-0 h-3 w-3 rounded-full shadow transition-transform ${checked ? 'translate-x-6 bg-retro-accent' : 'translate-x-0 bg-retro-muted'
          }`}
      />
    </button>
  )
})
