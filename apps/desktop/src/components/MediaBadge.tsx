export function MediaBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 bg-black/80 text-retro-accent text-[10px] font-black px-1.5 py-0.5 rounded tracking-wider ${className}`}
    >
      <span>▶</span> VIDEO
    </span>
  )
}