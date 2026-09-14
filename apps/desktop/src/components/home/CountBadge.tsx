"use client";

interface CountBadgeProps {
  /** Number to display. Renders nothing when <= 0. */
  count?: number;
  /** Cap display: counts above max render as `${max}+`. Defaults to 99. */
  max?: number;
  /** Accessible label. Defaults to `${count} unread`. */
  label?: string;
  className?: string;
}

/**
 * Numbered notification-indicator circle (chat / notifications / games).
 * Hidden at zero, capped at `max+` for large numbers. Absolutely positioned
 * by the caller (parent button must be `relative`).
 */
export function CountBadge({ count = 0, max = 99, label, className = '' }: CountBadgeProps) {
  if (!Number.isFinite(count) || count <= 0) return null;
  const n = Math.floor(count);
  const text = n > max ? `${max}+` : String(n);
  return (
    <span
      role="status"
      aria-label={label ?? `${n} unread`}
      className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-retro-error text-white text-[10px] font-bold leading-[18px] text-center tabular-nums ring-2 ring-retro-panel inline-flex items-center justify-center pointer-events-none ${className}`}
    >
      {text}
    </span>
  );
}
