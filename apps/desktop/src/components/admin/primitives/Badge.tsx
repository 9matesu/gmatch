"use client";

import { cn } from "../../../lib/utils";

type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "primary"
  | "neutral"
  | "active"
  | "inactive"
  | "pending"
  | "completed"
  | "draft"
  | "released"
  | "archived"
  | "banned"
  | "hidden"
  | "online"
  | "offline";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-surface-interactive text-retro-muted border border-border-glass",
  success: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  danger: "bg-red-500/15 text-red-400 border border-red-500/30",
  info: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30",
  primary: "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40",
  neutral: "bg-zinc-700 text-zinc-400 border border-zinc-600",
  active: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  inactive: "bg-zinc-700 text-zinc-400 border border-zinc-600",
  pending: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  completed: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  draft: "bg-zinc-700 text-zinc-400 border border-zinc-600",
  released: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  archived: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  banned: "bg-red-500/15 text-red-400 border border-red-500/30",
  hidden: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  online: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  offline: "bg-zinc-700 text-zinc-400 border border-zinc-600",
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md" | "lg";
  dot?: boolean;
  className?: string;
  onClick?: () => void;
}

export function Badge({
  children,
  variant = "default",
  size = "md",
  dot = false,
  className,
  onClick,
}: BadgeProps) {
  const sizeClasses = {
    sm: "px-1.5 py-0.5 text-[9px]",
    md: "px-2 py-0.5 text-[10px]",
    lg: "px-2.5 py-1 text-xs",
  };

  const dotColors: Record<BadgeVariant, string> = {
    default: "bg-retro-muted",
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    danger: "bg-red-400",
    info: "bg-cyan-400",
    primary: "bg-cyan-400",
    neutral: "bg-zinc-500",
    active: "bg-emerald-400",
    inactive: "bg-zinc-500",
    pending: "bg-amber-400",
    completed: "bg-emerald-400",
    draft: "bg-zinc-500",
    released: "bg-emerald-400",
    archived: "bg-amber-400",
    banned: "bg-red-400",
    hidden: "bg-amber-400",
    online: "bg-emerald-400",
    offline: "bg-zinc-500",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono font-bold uppercase tracking-wider rounded-full border",
        sizeClasses[size],
        variantClasses[variant],
        className,
        onClick && "cursor-pointer hover:opacity-80 transition-opacity"
      )}
      onClick={onClick}
    >
      {dot && <span className={cn("w-1.5 h-1.5 rounded-full", dotColors[variant])} />}
      {children}
    </span>
  );
}

interface StatusBadgeProps {
  status: string;
  mapping?: Record<string, BadgeVariant>;
  dot?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function StatusBadge({
  status,
  mapping = {},
  dot = true,
  size = "md",
  className,
}: StatusBadgeProps) {
  const defaultMapping: Record<string, BadgeVariant> = {
    active: "active",
    online: "online",
    live: "active",
    playing: "active",
    in_session: "active",
    in_match: "active",
    waiting: "pending",
    queued: "pending",
    lobby: "pending",
    ended: "completed",
    finished: "completed",
    resolved: "success",
    dismissed: "neutral",
    denied: "danger",
    visible: "active",
    offline: "offline",
    idle: "warning",
  };

  const variant = mapping[status] || defaultMapping[status] || "default";
  const label = status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return <Badge variant={variant} size={size} dot={dot} className={className}>{label}</Badge>;
}