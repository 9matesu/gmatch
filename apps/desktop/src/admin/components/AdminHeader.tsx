"use client";

import { cn } from "../../lib/utils";
import { Menu, Search, RefreshCw,  User, LogOut, ChevronDown, Settings } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { resolveMediaUrl } from "../../utils/media";
import { Button, Input } from "../../ui/kit";
import { classes, COLOR, GAP, ICON, MOTION, PADDING, PADDING_X, PADDING_X_MD, PADDING_Y, RADIUS, STATUS, TYPE, WEIGHT } from "../../ui/tokens";

interface AdminHeaderProps {
  isMobile: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSearch?: (query: string) => void;
  searchPlaceholder?: string;
  onRefresh?: () => void;
  isLoading?: boolean;
  user?: {
    name?: string;
    avatar?: string;
  };
  onNavigateTab?: (tab: string) => void;
  onSignOut?: () => void;
}

export function AdminHeader({
  isMobile,
  sidebarOpen,
  onToggleSidebar,
  onSearch,
  searchPlaceholder = "Search...",
  onRefresh,
  isLoading,
  user,
  onNavigateTab,
  onSignOut,
}: AdminHeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userMenuOpen]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSearch?.(searchQuery);
    }
  };

  return (
    <header className={cn(
      classes("h-14 border-b glass-toolbar flex items-center justify-between shrink-0 sticky top-0 z-[var(--z-dropdown)]", COLOR.edge, PADDING_X_MD[6], 'rounded-none'),
      isMobile && "px-3"
    )}>
      <div className={classes('flex items-center min-w-0', GAP[3])}>
        {isMobile && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleSidebar}
            className={PADDING[1.5]}
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            aria-expanded={sidebarOpen}
          >
            <Menu className={ICON.lg} />
          </Button>
        )}

        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md md:max-w-lg lg:max-w-xl">
          <Search className={classes('absolute left-3 top-1/2 -translate-y-1/2', ICON.md, COLOR.muted, 'pointer-events-none')} />
          <Input
            ref={searchRef}
            type="search"
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            className="pl-10 pr-10"
            aria-label="Search"
            autoComplete="off"
          />
        </form>
      </div>

      <div className={classes('flex items-center', GAP[2])}>
        {onRefresh && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className={PADDING[2]}
            aria-label="Refresh data"
            aria-busy={isLoading}
          >
            <RefreshCw className={cn(ICON.md, isLoading && "animate-spin")} />
          </Button>
        )}

        <div className="relative" ref={userMenuRef}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className={classes('flex items-center', GAP[2], PADDING[1.5])}
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
          >
            <div className={classes('w-7 h-7', RADIUS.pill, STATUS.infoBg, 'border', STATUS.infoEdge, 'flex items-center justify-center')}>
              {user?.avatar ? (
                <img src={resolveMediaUrl(user.avatar)} alt="" className={classes('w-full h-full', RADIUS.pill, 'object-cover')} />
              ) : (
                <User className={classes(ICON.md, STATUS.info)} />
              )}
            </div>
            <span className={classes('hidden sm:block', TYPE.body, WEIGHT.bold, COLOR.fg, 'max-w-[120px] truncate')}>
              {user?.name || "Administrator"}
            </span>
            <ChevronDown className={cn(classes(ICON.sm, COLOR.muted), userMenuOpen && "rotate-180", MOTION.transition.transform)} />
          </Button>

          {userMenuOpen && (
            <div className={classes('absolute right-0 top-full mt-2 z-[var(--z-dropdown)] min-w-[200px] bg-surface-elevated border', COLOR.edge, RADIUS.control, 'shadow-lg overflow-hidden', MOTION.keyframe.pop)}>
              <div className={classes(PADDING_X[3], PADDING_Y[2], 'border-b', COLOR.edge)}>
                <p className={classes(TYPE.body, WEIGHT.bold, COLOR.fg, 'truncate')}>{user?.name || "Administrator"}</p>
                <p className={classes(TYPE.caption, COLOR.muted, 'truncate font-mono')}>Admin Console</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setUserMenuOpen(false);
                  onNavigateTab?.("settings");
                }}
                className={classes('w-full text-left', TYPE.body, COLOR.fg, COLOR.hoverW10, 'flex items-center', GAP[2])}
              >
                <Settings className={ICON.sm} />
                Settings
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setUserMenuOpen(false);
                  onSignOut?.();
                }}
                className={classes('w-full text-left', TYPE.body, STATUS.danger, STATUS.dangerHoverBg, 'flex items-center', GAP[2])}
              >
                <LogOut className={ICON.sm} />
                Sign Out
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}