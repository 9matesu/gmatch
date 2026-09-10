import { memo } from 'react'

/**
 * Compact pill switch (user: "não gordos"). h-4 w-8 track, h-3 w-3 knob.
 * Kept 100% a11y-identical to the inline buttons it replaced: role="switch",
 * aria-checked, onClick — no visual-only wrappers.
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
      className={`h-4 w-8 shrink-0 cursor-pointer rounded-full border-0 p-0.5 transition-colors ${checked ? 'bg-retro-accent' : 'bg-surface-raised'
        }`}
    >
      <span
        className={`block h-3 w-3 rounded-full bg-surface-interactive shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'
          }`}
      />
    </button>
  )
})
