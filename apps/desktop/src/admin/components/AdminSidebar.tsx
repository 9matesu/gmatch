"use client";


import { cn } from "../../lib/utils";
import { X } from "lucide-react";

interface AdminSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  tabs: Array<{
    id: string;
    label: string;
    section: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | null;
    route?: string;
  }>;
  onClose?: () => void;
  className?: string;
}

export function AdminSidebar({
  activeTab,
  onTabChange,
  tabs,
  onClose,
  className,
}: AdminSidebarProps) {
  const sections = useMemo(() => {
    const seen = new Set<string>();
    return tabs.reduce((acc, tab) => {
      if (!seen.has(tab.section)) {
        seen.add(tab.section);
        acc.push(tab.section);
      }
      return acc;
    }, [] as string[]);
  }, [tabs]);

  return (
    <aside
      className={cn(
        "glass-panel border-r border-border-glass flex flex-col h-full overflow-hidden",
        "desktop-sidebar",
        className
      )}
      role="navigation"
      aria-label="Admin navigation"
    >
      <div className="p-4 border-b border-border-glass flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-retro-accent" />
          <div className="min-w-0">
            <div className="text-xs font-black tracking-tight text-retro-fg uppercase truncate">gMatch Admin</div>
            <div className="text-[10px] font-mono text-retro-muted">Moderation Console</div>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-glass-w10 text-retro-muted hover:text-retro-fg transition-colors lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-3" role="list">
        {sections.map((section, _sectionIndex) => (
          <div key={section} className="space-y-1">
            <div className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-retro-faint">
              {section}
            </div>
            {tabs
              .filter(tab => tab.section === section)
              .map(tab => {
                const active = activeTab === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onTabChange(tab.id)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer",
                      active
                        ? "bg-retro-accent/15 text-retro-accent border border-retro-accent/30"
                        : "text-retro-muted hover:text-retro-fg hover:bg-glass-w5 border border-transparent"
                    )}
                    role="listitem"
                    aria-current={active ? "page" : undefined}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon className={cn("w-4 h-4 shrink-0", active ? "text-retro-accent" : "text-retro-muted")} />
                      <span className="truncate">{tab.label}</span>
                    </div>
                    {tab.badge && (
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold",
                        active ? "bg-retro-selection text-retro-accent" : "bg-glass-w8 text-retro-muted",
                        tab.id === "reports" && tab.badge && Number(tab.badge) > 0 && "bg-red-500 text-white"
                      )}>
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-border-glass space-y-2">
        <div className="flex items-center justify-between text-[10px] font-mono text-retro-muted">
          <span>Admin Status:</span>
          <span className="text-emerald-400 font-bold uppercase tracking-wider">Active</span>
        </div>
        <a
          href="/"
          className="w-full block text-center py-2 bg-surface-interactive hover:bg-glass-w10 text-retro-fg rounded font-bold text-xs transition-colors"
        >
          Return to App
        </a>
      </div>
    </aside>
  );
}

import { useMemo } from "react";
