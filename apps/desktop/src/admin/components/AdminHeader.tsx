"use client";

import { cn } from "../../lib/utils";
import { Menu, Search, RefreshCw,  User, LogOut, ChevronDown, Settings } from "lucide-react";
import { useState, useRef, useEffect } from "react";

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
      "h-14 metro-rule px-4 md:px-6 flex items-center justify-between shrink-0 glass-toolbar border-0 border-b border-border-glass rounded-none sticky top-0 z-30",
      isMobile && "px-3"
    )}>
      <div className="flex items-center gap-3 min-w-0">
        {isMobile && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="p-1.5 rounded hover:bg-glass-w10 text-retro-fg transition-colors lg:hidden"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            aria-expanded={sidebarOpen}
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md md:max-w-lg lg:max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-retro-muted pointer-events-none" />
          <input
            ref={searchRef}
            type="search"
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            className="w-full bg-surface-raised border border-border-glass pl-10 pr-10 py-1.5 text-xs text-retro-fg placeholder:text-retro-muted rounded-md outline-none focus:border-retro-accent/60"
            aria-label="Search"
            autoComplete="off"
          />
        </form>
      </div>

      <div className="flex items-center gap-2">
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 rounded border border-border-glass bg-surface-interactive hover:bg-glass-w10 text-retro-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Refresh data"
            aria-busy={isLoading}
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </button>
        )}

        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 p-1.5 rounded hover:bg-glass-w10 transition-colors"
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
          >
            <div className="w-7 h-7 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                <User className="w-4 h-4 text-cyan-300" />
              )}
            </div>
            <span className="hidden sm:block text-xs font-bold text-retro-fg max-w-[120px] truncate">
              {user?.name || "Administrator"}
            </span>
            <ChevronDown className={cn("w-3.5 h-3.5 text-retro-muted transition-transform", userMenuOpen && "rotate-180")} />
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-2 z-50 min-w-[200px] bg-surface-elevated border border-border-glass rounded-lg shadow-lg overflow-hidden animate-orbit-pop">
              <div className="px-3 py-2 border-b border-border-glass">
                <p className="text-xs font-bold text-retro-fg truncate">{user?.name || "Administrator"}</p>
                <p className="text-[10px] text-retro-muted truncate font-mono">Admin Console</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  onNavigateTab?.("settings");
                }}
                className="w-full px-3 py-2 text-left text-xs text-retro-fg hover:bg-glass-w10 transition-colors flex items-center gap-2"
              >
                <Settings className="w-3.5 h-3.5" />
                Settings
              </button>
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  onSignOut?.();
                }}
                className="w-full px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10 transition-colors flex items-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}