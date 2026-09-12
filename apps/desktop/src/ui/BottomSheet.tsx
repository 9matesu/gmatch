"use client";

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { playPress } from '../utils/sounds';

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  maxHeight?: string;
  className?: string;
}

export function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  maxHeight = 'max-h-[88vh]',
  className = '',
}: BottomSheetProps) {
  const [startY, setStartY] = useState<number | null>(null);
  const [currentTranslateY, setCurrentTranslateY] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);

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

  const handleTouchStart = (e: React.TouchEvent) => {
    setStartY(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY === null) return;
    const deltaY = e.touches[0].clientY - startY;
    if (deltaY > 0) {
      setCurrentTranslateY(deltaY);
    }
  };

  const handleTouchEnd = () => {
    if (currentTranslateY > 120) {
      playPress(700);
      onClose();
    }
    setCurrentTranslateY(0);
    setStartY(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col justify-end pointer-events-auto"
    >
      {/* Scrim backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200"
        onClick={() => {
          playPress(700);
          onClose();
        }}
        aria-hidden="true"
      />

      {/* Sheet panel */}
      <div
        ref={sheetRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: currentTranslateY > 0 ? `translateY(${currentTranslateY}px)` : undefined,
        }}
        className={`relative w-full max-w-2xl mx-auto ${maxHeight} flex flex-col bg-[#131722] border-t border-x border-white/10 rounded-t-3xl shadow-[0_-12px_40px_rgba(0,0,0,0.8)] overflow-hidden animate-sheet-up ${className}`}
      >
        {/* Tactile drag handle */}
        <div className="w-full flex items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors" />
        </div>

        {/* Optional Header */}
        {title && (
          <div className="flex items-center justify-between px-5 pb-3 border-b border-white/8 shrink-0">
            <div className="text-sm font-bold text-white tracking-wide">{title}</div>
            <button
              type="button"
              onClick={() => {
                playPress(700);
                onClose();
              }}
              className="p-1 rounded-lg text-retro-muted hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Scrollable sheet body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 styled-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}
