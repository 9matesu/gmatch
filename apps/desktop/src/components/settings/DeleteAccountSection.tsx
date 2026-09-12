import { useState } from 'react';
import { AlertTriangle, Copy, Trash2 } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import { orbitFetch } from '../../utils/api';
import { purgeAllLocalTraces } from '../../utils/accountPurge';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

/** Same payload shape the identity export modal produces. */
function identityKeyPayload(identity: OrbitIdentity, displayName: string): string {
  return JSON.stringify(
    {
      ...identity,
      displayName: displayName.trim() || undefined,
      version: 1,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

/**
 * Danger zone: deletes the account on the server and wipes every local
 * trace on this device (keys, saves, caches, grants), then hands control
 * back so the shell lands on the register-again screen.
 */
export function DeleteAccountSection({
  identity,
  displayName,
  toast,
  onDeleted,
}: {
  identity: OrbitIdentity | null;
  displayName: string;
  toast: ToastFn;
  onDeleted: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'erasing'>('idle');
  const [typed, setTyped] = useState('');
  const [ack, setAck] = useState(false);
  const [keyShown, setKeyShown] = useState(false);
  const [error, setError] = useState('');

  if (!identity) return null;

  const expected = (displayName || identity.orbitId).trim();
  const canDelete = ack && typed.trim() === expected;

  const start = () => {
    setError('');
    setPhase(phase === 'confirm' ? 'idle' : 'confirm');
  };

  const runDelete = async () => {
    if (!canDelete) return;
    setPhase('erasing');
    setError('');
    try {
      const res = await orbitFetch('/api/users/account', { method: 'DELETE' }, identity);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as Record<string, unknown>);
        throw new Error(typeof body?.error === 'string' ? body.error : `Server refused (${res.status})`);
      }
      await purgeAllLocalTraces();
      toast('Account and local traces deleted.', 'success');
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed. Nothing was erased locally until the server confirmed.');
      setPhase('confirm');
    }
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(identityKeyPayload(identity, displayName));
      toast('Secret key copied. Store it somewhere outside gMatch.', 'success');
    } catch {
      toast('Clipboard blocked; reveal the key and copy it manually.', 'warning');
    }
  };

  return (
    <div className="rounded-xl border border-red-900/60 bg-red-950/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
        <h4 className="text-xs font-semibold text-red-300">Delete account &amp; erase this device</h4>
      </div>
      <p className="text-xs text-retro-muted leading-relaxed">
        Deletes your account and everything it touched on the server: profile, cards, posts,
        stories, messages, decks, wallet balance and marketplace listings. This device is wiped
        too: your secret key, sign-in, saved game, images held in memory, folder permissions and
        all local settings. <strong className="text-red-300">There is no undo and no recovery
        without your exported secret key</strong>. And even with it, a deleted account cannot be
        restored. Report and ban records tied to safety enforcement are kept in anonymized form.
      </p>

      {phase === 'idle' && (
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-800 text-red-300 text-xs font-bold hover:bg-red-950/50 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete my account
        </button>
      )}

      {(phase === 'confirm' || phase === 'erasing') && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setKeyShown((v) => !v)}
              className="px-2.5 py-1 rounded-md border border-border-glass text-retro-muted hover:text-retro-fg cursor-pointer"
            >
              {keyShown ? 'Hide secret key' : 'Reveal secret key first (recommended)'}
            </button>
            {keyShown && (
              <>
                <code className="break-all flex-1 min-w-[160px] rounded-md bg-black/40 border border-border-glass px-2 py-1 font-mono text-[10px] text-retro-fg">
                  {identityKeyPayload(identity, displayName)}
                </code>
                <button
                  type="button"
                  onClick={copyKey}
                  className="p-1.5 rounded-md border border-border-glass text-retro-muted hover:text-retro-fg cursor-pointer"
                  aria-label="Copy secret key"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => { setAck(e.target.checked); }}
              className="mt-0.5 w-4 h-4 rounded border-red-800 bg-black/40 accent-red-500 cursor-pointer"
            />
            <span className="text-xs text-retro-fg leading-snug">
              I understand this permanently deletes my account and wipes every local trace on this device.
            </span>
          </label>

          <div className="space-y-1.5">
            <label htmlFor="delete-confirm-name" className="text-xs text-retro-muted">
              Type <span className="font-mono text-retro-fg">{expected}</span> to confirm
            </label>
            <input
              id="delete-confirm-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="w-full bg-surface-interactive border border-red-900/60 rounded-lg px-3 py-2 text-xs text-retro-fg outline-none focus:border-red-500"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-red-800 bg-red-950/40 p-2.5 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setPhase('idle'); setTyped(''); setAck(false); setError(''); }}
              disabled={phase === 'erasing'}
              className="px-3 py-1.5 rounded-lg border border-border-glass text-xs text-retro-muted hover:text-retro-fg disabled:opacity-40 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={runDelete}
              disabled={!canDelete || phase === 'erasing'}
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-30 disabled:pointer-events-none text-white text-xs font-bold cursor-pointer inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {phase === 'erasing' ? 'Erasing…' : 'Delete forever'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
