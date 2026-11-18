export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function CardSkeleton() {
  return (
    <div className="bg-retro-panel border border-edge overflow-hidden">
      <div className="p-3 border-b border-edge flex justify-between items-center">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-4" />
      </div>
      <div className="aspect-square bg-retro-bg flex items-center justify-center">
        <Skeleton className="h-full w-full" />
      </div>
      <div className="p-4 space-y-2">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <main id="main-content" role="status" aria-label="Loading page" className="flex-grow flex items-center justify-center">
      <div className="font-sans text-sm text-retro-muted animate-pulse">Loading…</div>
    </main>
  );
}
