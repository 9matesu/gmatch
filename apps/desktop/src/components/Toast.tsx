"use client";

import { useState, useEffect, createContext, useContext, useCallback } from 'react';

export interface ToastMessage {
  id: string;
  text: string;
  type: 'success' | 'error' | 'info' | 'warning';
  sender?: string;
  /** Errors persist until dismissed (max 1 sticky at a time). */
  sticky?: boolean;
  ts: number;
}

interface ToastCtx {
  toast: (text: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  messages: ToastMessage[];
  dismiss: (id: string) => void;
  clearAll: () => void;
  /** Transient items dropped due to the overflow cap. */
  overflowCount: number;
}

const DEDUPE_WINDOW_MS = 5000;
const MAX_TRANSIENT = 3;

export function durationFor(type: ToastMessage['type'], sticky?: boolean): number | null {
  if (sticky) return null;
  if (type === 'error') return null; // errors persist until dismissed
  if (type === 'warning') return 5000;
  return 3000;
}

const ToastContext = createContext<ToastCtx>({ toast: () => { }, messages: [], dismiss: () => { }, clearAll: () => { }, overflowCount: 0 });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const [overflowCount, setOverflowCount] = useState(0);

  useEffect(() => {
    const clearOnLogout = () => { setMessages([]); setOverflowCount(0); };
    window.addEventListener('orbit-identity-cleared', clearOnLogout);
    return () => window.removeEventListener('orbit-identity-cleared', clearOnLogout);
  }, []);

  const dismiss = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setMessages([]);
    setOverflowCount(0);
  }, []);

  const toast = useCallback((text: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    const clean = String(text || '').trim().slice(0, 280);
    if (!clean) return;
    const now = Date.now();
    const sticky = type === 'error';
    setMessages(prev => {
      // Dedupe: suppress identical severity+text within the window without
      // extending the original's lifetime (first timestamp wins).
      if (prev.some(m => m.type === type && m.text === clean && now - m.ts < DEDUPE_WINDOW_MS)) return prev;
      const id = now.toString(36) + Math.random().toString(36).slice(2, 6);
      const next = [...prev, { id, text: clean, type, sticky, ts: now }];
      // Cap: one sticky error + MAX_TRANSIENT others; extras count as overflow.
      const stickies = next.filter(m => m.sticky);
      const rest = next.filter(m => !m.sticky);
      const keptSticky = stickies.slice(-1);
      const keptRest = rest.slice(-MAX_TRANSIENT);
      const dropped = next.length - keptSticky.length - keptRest.length;
      if (dropped > 0) setOverflowCount(c => c + dropped);
      return [...keptSticky, ...keptRest];
    });
  }, []);

  return (
    <ToastContext.Provider value={{ toast, messages, dismiss, clearAll, overflowCount }}>
      {children}
    </ToastContext.Provider>
  );
}
