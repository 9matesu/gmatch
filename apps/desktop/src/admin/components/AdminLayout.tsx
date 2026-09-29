"use client";

import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";

interface AdminLayoutProps {
  children: React.ReactNode;
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
  user?: {
    name?: string;
    avatar?: string;
  };
  onSearch?: (query: string) => void;
  searchPlaceholder?: string;
  onRefresh?: () => void;
  isLoading?: boolean;
  onSignOut?: () => void;
}

export function AdminLayout({
  children,
  activeTab,
  onTabChange,
  tabs,
  user,
  onSearch,
  searchPlaceholder = "Search...",
  onRefresh,
  isLoading,
  onSignOut,
}: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
      if (window.innerWidth >= 1024) setSidebarOpen(false);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col">
      <AdminHeader
        isMobile={isMobile}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onSearch={onSearch}
        searchPlaceholder={searchPlaceholder}
        onRefresh={onRefresh}
        isLoading={isLoading}
        user={user}
        onNavigateTab={onTabChange}
        onSignOut={onSignOut}
      />

      <div className="flex-1 flex overflow-hidden">
        {isMobile ? (
          <>
            {sidebarOpen && (
              <div
                className="fixed inset-0 z-[var(--z-dropdown)] bg-black/70 animate-orbit-fade-in lg:hidden"
                onClick={() => setSidebarOpen(false)}
                aria-hidden="true"
              />
            )}
            <AdminSidebar
              className={cn(
                "fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-300 ease-out lg:static lg:translate-x-0",
                sidebarOpen ? "translate-x-0" : "-translate-x-full"
              )}
              activeTab={activeTab}
              onTabChange={onTabChange}
              tabs={tabs}
              onClose={() => setSidebarOpen(false)}
            />
          </>
        ) : (
          <AdminSidebar
            activeTab={activeTab}
            onTabChange={onTabChange}
            tabs={tabs}
          />
        )}

        <section aria-label="Admin workspace" className="flex-1 overflow-y-auto min-w-0 lg:ml-0">
          <div className="p-4 md:p-6 space-y-6">
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}