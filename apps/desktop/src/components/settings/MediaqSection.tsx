"use client";

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Play, Sparkles } from 'lucide-react';
import { useMediaqInstall } from '../../services/mediaqInstall';
import { classes, COLOR, GAP, ICON, MONO, MOTION, STATUS, TYPE } from '../../ui/tokens';

interface MediaqStatus {
  installed: boolean;
  running: boolean;
  base: string;
  error?: string;
}

/**
 * Settings > Preferences: the optional media suite.
 *
 * One click downloads uv, installs mediaq (with a managed Python 3.12) and
 * starts it locally. Progress comes from the SAME store the first-run modal and
 * the notification centre use, so closing Settings during an install ("Send to
 * background") never cancels it and the bar keeps moving. Once it is up, the
 * clicker's mediaq ContentProvider answers automatically for both the real and
 * hentai tiers — no configuration, no restart. With no bridge (browser dev) the
 * section says so and the clicker keeps working on its local sources.
 */
export function MediaqSection({
  onClose,
  toast,
}: {
  onClose?: () => void;
  toast?: (message: string, type?: 'success' | 'error' | 'info' | 'warning' | string) => void;
}) {
  const mediaq = useMediaqInstall();
  const [status, setStatus] = useState<MediaqStatus | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let live = true;
    const probe = () => {
      const g = window.gmatch;
      if (!g?.mediaqStatus) return;
      void g.mediaqStatus().then(
        (st) => { if (live) setStatus(st); },
        () => { /* offline probe: leave the last-known status alone */ },
      );
    };
    probe();
    // A finished install starts the sidecar in the main process; refresh the
    // "running" line when that happens (status is stable while installing).
    if (mediaq.status === 'done' || mediaq.status === 'cancelled') probe();
    return () => { live = false; };
  }, [mediaq.status]);

  const bridged = Boolean(window.gmatch?.mediaqInstall);
  const installing = mediaq.status === 'installing';
  const installed = Boolean(status?.installed) || mediaq.status === 'done';

  const start = () => {
    toast?.('Installing the media suite — progress stays visible in Notifications.', 'info');
    // Inline install: no modal pops over Settings, but the shared store still
    // drives the notification centre and the first-run setup modal.
    mediaq.start(false);
  };

  const startServer = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const res = await window.gmatch?.mediaqStart?.();
      if (res?.ok) {
        setStatus((s) => (s ? { ...s, running: true } : s));
        toast?.('Media suite is running — the clicker will use it on the next fetch.', 'success');
      } else {
        toast?.(res?.error ? `Could not start the media suite: ${res.error}` : 'Could not start the media suite', 'error');
      }
    } catch {
      toast?.('Could not start the media suite', 'error');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="p-4 bg-glass-w5 border border-edge rounded-lg space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xs font-medium uppercase tracking-wider text-retro-muted">
          Media suite <span className="normal-case tracking-normal">(optional)</span>
        </span>
        <Sparkles className={classes(ICON.md, installed ? STATUS.success : COLOR.muted)} />
      </div>

      <p className="text-xs text-retro-body">
        Adds real and hentai picture sources to the clicker. It installs once on
        this device (a small Python manager plus mediaq) and runs locally. The
        app works fully offline without it.
      </p>

      {!bridged && (
        <p className="text-2xs text-retro-muted">
          Desktop app only. The browser build keeps its local sources and ignores this section.
        </p>
      )}

      {bridged && installed && !installing && (
        <p className={classes('flex items-center', GAP[1.5], TYPE.caption, STATUS.success)}>
          <CheckCircle2 className={ICON.sm} />
          {status?.running
            ? 'Installed and running — used automatically by the clicker.'
            : 'Installed. Start the local server to use it in the clicker.'}
        </p>
      )}

      {bridged && installed && !installing && !status?.running && (
        <button
          type="button"
          onClick={() => void startServer()}
          disabled={starting}
          aria-busy={starting}
          className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-glass-w8 px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-glass-w12 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <Play className={ICON.sm} />
          {starting ? 'Starting…' : 'Start media suite'}
        </button>
      )}

      {installing && (
        <div className="space-y-1.5" role="status" aria-live="polite">
          <div className="h-2 w-full overflow-hidden rounded-full bg-glass-w8">
            {mediaq.percent !== null ? (
              <div
                className={classes('h-full rounded-full bg-retro-accent', MOTION.transition.width)}
                style={{ width: `${mediaq.percent}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-retro-accent" />
            )}
          </div>
          <div className="flex justify-between text-2xs text-retro-muted">
            <span className="truncate">{mediaq.message || 'Installing…'}</span>
            {mediaq.percent !== null && <span className={MONO}>{mediaq.percent}%</span>}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => { onClose?.(); }}
              className="inline-flex items-center rounded-md border border-edge bg-glass-w8 px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-glass-w12 cursor-pointer"
            >
              Send to background
            </button>
            <button
              type="button"
              onClick={() => mediaq.cancel()}
              className="inline-flex items-center rounded-md border border-retro-error/40 bg-retro-error/15 px-2.5 py-1.5 text-xs font-medium text-retro-error hover:bg-retro-error/25 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {bridged && !installed && !installing && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <button
            type="button"
            onClick={start}
            disabled={!bridged}
            className="inline-flex items-center gap-1.5 rounded-md border border-retro-accent bg-retro-accent px-2.5 py-1.5 text-xs font-semibold text-retro-accent-text hover:bg-retro-accent-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Download className={ICON.sm} />
            {mediaq.status === 'error' || mediaq.status === 'cancelled' ? 'Retry install' : 'Install media suite'}
          </button>
          <span className="text-2xs text-retro-muted">First run downloads ~100 MB and never leaves this device.</span>
        </div>
      )}

      {mediaq.status === 'error' && !installing && (
        <p className={classes('flex items-center', GAP[1.5], TYPE.caption, STATUS.danger)} role="alert">
          <AlertCircle className={ICON.sm} />
          <span className="truncate">{mediaq.message || 'Install failed.'}</span>
        </p>
      )}
      {mediaq.status === 'cancelled' && !installing && (
        <p className={classes(TYPE.caption, STATUS.warning)}>Install cancelled. Nothing was changed.</p>
      )}
    </div>
  );
}
