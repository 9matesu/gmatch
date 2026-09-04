"use client";

import { cn } from "../../../lib/utils";

interface AdminEmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  illustration?: "search" | "folder" | "inbox" | "users" | "shield" | "chart" | "cog";
}

const illustrations: Record<string, React.ReactNode> = {
  search: (
    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="11" cy="11" r="8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
    </svg>
  ),
  folder: (
    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  inbox: (
    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
    </svg>
  ),
  users: (
    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  shield: (
    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  chart: (
    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6m6 6V5m-12 14h18M3 5v14" />
    </svg>
  ),
  cog: (
    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1v2m0 18v2M4.93 4.93l1.414 1.414m12.728 0l1.414-1.414M1 12h2m18 0h2M4.93 19.07l1.414-1.414m12.728 0l1.414 1.414" />
    </svg>
  ),
};

export function AdminEmptyState({
  icon,
  title,
  description,
  action,
  className,
  illustration = "folder",
}: AdminEmptyStateProps) {
  return (
    <div className={cn("empty-state flex flex-col items-center justify-center text-center", className)}>
      {icon || illustrations[illustration] ? (
        <div className="text-retro-muted/50 mb-4">
          {icon || illustrations[illustration]}
        </div>
      ) : null}
      <h3 className="text-sm font-bold text-retro-fg mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-retro-muted max-w-sm mx-auto mb-4">{description}</p>
      )}
      {action && (
        <div className="mt-2">{action}</div>
      )}
    </div>
  );
}

interface AdminLoadingStateProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function AdminLoadingState({ rows = 5, columns = 6, className }: AdminLoadingStateProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid gap-3 px-3 py-2 border-b border-border-glass bg-surface-raised">
        <div className="grid grid-cols-12 gap-3">
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className="skeleton h-5 w-full" style={{ gridColumn: `span ${Math.floor(12 / columns)}` }} />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid grid-cols-12 gap-3 px-3 py-3 border-b border-border-subtle">
          {Array.from({ length: columns }).map((_, i) => (
            <div
              key={i}
              className="skeleton h-8 w-full"
              style={{ gridColumn: `span ${Math.floor(12 / columns)}` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface AdminErrorStateProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function AdminErrorState({ message, onRetry, className }: AdminErrorStateProps) {
  return (
    <div className={cn("empty-state", className)}>
      <svg className="w-12 h-12 text-retro-error mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <h3 className="text-sm font-bold text-retro-fg mb-1">Unable to load data</h3>
      <p className="text-xs text-retro-muted max-w-sm mx-auto mb-4">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 bg-cyan-500 text-black text-xs font-bold rounded hover:bg-cyan-400 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}