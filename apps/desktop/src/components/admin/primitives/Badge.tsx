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
  success: "bg-success/5 text-success-fg border border-success/0",
  warning: "bg-warning/5 text-warning-fg border border-warning/0",
  danger: "bg-danger/5 text-danger-fg border border-danger/0",
  info: "bg-info/5 text-info-fg border border-info/0",
  primary: "bg-info/0 text-info-fg border border-info/0",
  neutral: "bg-glass-w20 text-retro-muted border border-border-glass",
  active: "bg-success/5 text-success-fg border border-success/0",
  inactive: "bg-glass-w20 text-retro-muted border border-border-glass",
  pending: "bg-warning/5 text-warning-fg border border-warning/0",
  completed: "bg-success/5 text-success-fg border border-success/0",
  draft: "bg-glass-w20 text-retro-muted border border-border-glass",
  released: "bg-success/5 text-success-fg border border-success/0",
  archived: "bg-warning/5 text-warning-fg border border-warning/0",
  banned: "bg-danger/5 text-danger-fg border border-danger/0",
  hidden: "bg-warning/5 text-warning-fg border border-warning/0",
  online: "bg-success/5 text-success-fg border border-success/0",
  offline: "bg-glass-w20 text-retro-muted border border-border-glass",
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
    sm: "px-1.5 py-0.5 text-2xs",
    md: "px-2 py-0.5 text-2xs",
    lg: "px-2.5 py-1 text-xs",
  };

  const dotColors: Record<BadgeVariant, string> = {
    default: "bg-retro-muted",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    primary: "bg-info",
    neutral: "bg-retro-muted",
    active: "bg-success",
    inactive: "bg-retro-muted",
    pending: "bg-warning",
    completed: "bg-success",
    draft: "bg-retro-muted",
    released: "bg-success",
    archived: "bg-warning",
    banned: "bg-danger",
    hidden: "bg-warning",
    online: "bg-success",
    offline: "bg-retro-muted",
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