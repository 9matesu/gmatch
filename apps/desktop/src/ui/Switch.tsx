import { memo } from 'react'

/**
 * Pill switch: one slim rounded track + one round knob.
 * role="switch", aria-checked, onClick. Colour and elevation come from tokens.
 *
 * The BUTTON is the hit area (the global `button { min-height: 32px }` keeps it
 * ≥32px tall and w-11 keeps it a comfortable tap target); the visible track is
 * a slim, centred child so the control reads light instead of fat. Track
 * h-4 w-8, knob h-3 w-3, travel translate-x-4 — all existing spacing tokens.
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
      className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 p-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-retro-accent"
    >
      <span
        aria-hidden="true"
        className={`flex h-4 w-8 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-retro-accent' : 'bg-surface-interactive'
          }`}
      >
        <span
          aria-hidden="true"
          className={`block h-3 w-3 rounded-full shadow-sm transition-transform ${checked ? 'translate-x-4 bg-retro-accent-text' : 'translate-x-0 bg-retro-muted'
            }`}
        />
      </span>
    </button>
  )
})
