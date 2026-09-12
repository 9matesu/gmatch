"use client";

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { playPress } from '../utils/sounds';

export interface SideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
  className?: string;
}

export function SideDrawer({
  isOpen,
  onClose,
  title,
  children,
  width = 'w-full sm:w-96 md:w-[420px]',
  className = '',
}: SideDrawerProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[var(--z-modal)] flex justify-end pointer-events-auto"
    >
      {/* Scrim backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200"
        onClick={() => {
          playPress(700);
          onClose();
        }}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        className={`relative h-full ${width} flex flex-col bg-[#131722] border-l border-white/10 shadow-[-16px_0_48px_rgba(0,0,0,0.8)] overflow-hidden animate-drawer-right z-10 ${className}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 shrink-0">
          <div className="text-sm font-bold text-white tracking-wide">{title || ''}</div>
          <button
            type="button"
            onClick={() => {
              playPress(700);
              onClose();
            }}
            className="p-1 rounded-lg text-retro-muted hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 styled-scrollbar">
          {children}
        </div>
      </aside>
    </div>
  );
}
