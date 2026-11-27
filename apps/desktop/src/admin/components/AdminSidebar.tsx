"use client";


import { cn } from "../../lib/utils";
import { X } from "lucide-react";
import { Button } from "../../ui/kit";
import { classes, COLOR, GAP, ICON, MOTION, PADDING, PADDING_X, PADDING_Y, RADIUS, STATUS, TRACKING, TYPE, WEIGHT } from "../../ui/tokens";

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
        "glass-panel border-r border-edge flex flex-col h-full overflow-hidden",
        "desktop-sidebar",
        className
      )}
      role="navigation"
      aria-label="Admin navigation"
    >
      <div className={classes(PADDING[4], 'border-b', COLOR.edge, 'flex items-center justify-between')}>
        <div className={classes('flex items-center', GAP[2])}>
          <span className={classes('w-2.5 h-2.5', RADIUS.pill, COLOR.accentBg)} />
          <div className="min-w-0">
            <div className={classes(TYPE.body, WEIGHT.heading, TRACKING.tight, COLOR.fg, 'uppercase truncate')}>gMatch Admin</div>
            <div className={classes(TYPE.caption, 'font-mono', COLOR.muted)}>Moderation Console</div>
          </div>
        </div>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className={PADDING[1.5]}
            aria-label="Close sidebar"
          >
            <X className={ICON.md} />
          </Button>
        )}
      </div>

      <nav className={classes('flex-1 overflow-y-auto', PADDING[3], 'space-y-3')} role="list">
        {sections.map((section, _sectionIndex) => (
          <div key={section} className={classes('space-y-1', TRACKING.tight)}>
            <div className={classes(PADDING_X[3], PADDING_Y[2], TYPE.caption, WEIGHT.heading, 'uppercase', TRACKING.wider, COLOR.faint)}>
              {section}
            </div>
            {tabs
              .filter(tab => tab.section === section)
              .map(tab => {
                const active = activeTab === tab.id;
                const Icon = tab.icon;
                return (
                  <Button
                    key={tab.id}
                    type="button"
                    variant={active ? 'secondary' : 'ghost'}
                    onClick={() => onTabChange(tab.id)}
                    className={classes('w-full flex items-center justify-between', PADDING_X[3], PADDING_Y[2.5], TYPE.body, WEIGHT.bold, active ? COLOR.accent : COLOR.muted)}
                    role="listitem"
                    aria-current={active ? "page" : undefined}
                  >
                    <div className={classes('flex items-center min-w-0', GAP[2.5])}>
                      <Icon className={cn(ICON.md, 'shrink-0', active ? COLOR.accent : COLOR.muted)} />
                      <span className="truncate">{tab.label}</span>
                    </div>
                    {tab.badge && (
                      <span className={cn(
                        classes(TYPE.caption, PADDING_X[1.5], 'py-0.5', RADIUS.pill, 'font-mono', WEIGHT.bold),
                        active ? classes(COLOR.selectionBg, COLOR.accent) : classes(COLOR.glassW8, COLOR.muted),
                        tab.id === "reports" && tab.badge && Number(tab.badge) > 0 && classes(STATUS.dangerBg, STATUS.dangerFg)
                      )}>
                        {tab.badge}
                      </span>
                    )}
                  </Button>
                );
              })}
          </div>
        ))}
      </nav>

      <div className={classes(PADDING[4], 'border-t', COLOR.edge, 'space-y-2')}>
        <div className={classes('flex items-center justify-between', TYPE.caption, 'font-mono', COLOR.muted)}>
          <span>Admin Status:</span>
          <span className={classes(STATUS.success, WEIGHT.bold, 'uppercase', TRACKING.wider)}>Active</span>
        </div>
        <a
          href="/"
          className={classes('w-full block text-center', PADDING_Y[2], COLOR.interactive, COLOR.hoverW10, COLOR.fg, RADIUS.chip, WEIGHT.bold, TYPE.body, MOTION.transition.micro)}
        >
          Return to App
        </a>
      </div>
    </aside>
  );
}

import { useMemo } from "react";
