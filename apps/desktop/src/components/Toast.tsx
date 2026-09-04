"use client";

import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';

interface ToastMessage {
  id: string;
  text: string;
  type: 'success' | 'error' | 'info' | 'warning';
  sender?: string;
}

interface ToastCtx {
  toast: (text: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const ToastContext = createContext<ToastCtx>({ toast: () => { } });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const clearOnLogout = () => setMessages([]);
    window.addEventListener('orbit-identity-cleared', clearOnLogout);
    return () => window.removeEventListener('orbit-identity-cleared', clearOnLogout);
  }, []);

  const toast = useCallback((text: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setMessages(prev => [...prev, { id, text, type }]);
  }, []);

  const remove = (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-20 md:bottom-5 right-5 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
        {messages.map(msg => (
          <ToastItem key={msg.id} message={msg} onDone={() => remove(msg.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ message, onDone }: { message: ToastMessage; onDone: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDone, 200);
    }, 4500);
    return () => clearTimeout(timer);
  }, [onDone]);

  const IconComp =
    message.type === 'success'
      ? CheckCircle2
      : message.type === 'error'
      ? AlertCircle
      : message.type === 'warning'
      ? AlertTriangle
      : Info;

  const iconColor =
    message.type === 'success'
      ? 'text-emerald-400'
      : message.type === 'error'
      ? 'text-red-400'
      : message.type === 'warning'
      ? 'text-amber-400'
      : 'text-retro-body';

  return (
    <div
      className={`pointer-events-auto bg-surface-canvas/95 border border-zinc-800 rounded-xl px-3.5 py-2.5 shadow-2xl backdrop-blur-md transition-all duration-200 flex items-start gap-2.5 max-w-sm ${
        visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95'
      }`}
    >
      <IconComp className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
      <span className="text-xs text-retro-body leading-relaxed break-words font-medium">{message.text}</span>
    </div>
  );
}
