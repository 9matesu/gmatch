import { ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';

export function SecurityWarning({ className = '' }: { className?: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className={`glass-panel p-3 flex items-start gap-2.5 text-xs ${className}`}>
      <ShieldAlert className="w-4 h-4 text-retro-accent shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-retro-fg leading-tight">Security Notice</p>
        <p className="text-[11px] text-retro-muted mt-0.5 leading-relaxed">
          Never paste code, keys, or tokens into your browser console. goonMatch will never ask you to do this. Pasting into DevTools can expose your account.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="p-1 text-retro-muted hover:text-retro-fg rounded-md cursor-pointer transition-colors shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
