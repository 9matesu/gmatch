"use client";

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Play, RotateCcw, Sparkles, Square } from 'lucide-react';
import { useMediaqInstall } from '../../services/mediaqInstall';
import {
  buttonClass, classes, COLOR, GAP, ICON, MONO, MOTION, PADDING,
  STATUS, TRACKING, TYPE, WEIGHT,
} from '../../ui/tokens';

interface MediaqStatus {
  installed: boolean;
  running: boolean;
  base: string;
  hasUv?: boolean;
  error?: string;
}

type ServerAction = 'start' | 'stop' | 'restart';

/**
 * Settings > Preferences: the optional media suite.
 *
 * One click downloads uv, installs mediaq (with a managed Python 3.12) and
 * starts it locally. Progress comes from the SAME store the first-run modal and
 * the notification centre use, so closing Settings during an install ("Send to
 * background") never cancels it. Once installed, Start / Stop / Restart drive
 * the local server and every outcome is reported from the real IPC result — an
 * installed-but-not-running server is never shown as ready. With no bridge
 * (browser dev) the section says so and the clicker keeps its local sources.
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
  const [busy, setBusy] = useState<ServerAction | null>(null);

  const probeStatus = useCallback(async () => {
    const g = window.gmatch;
    if (!g?.mediaqStatus) return;
    try {
      setStatus(await g.mediaqStatus());
    } catch {
      /* offline probe: leave the last-known status alone */
    }
  }, []);

  useEffect(() => {
    // Re-read when the shared install state settles: the main process starts the
    // server at the end of an install, so "running" can change without a click.
    void probeStatus();
  }, [mediaq.status, probeStatus]);

  const bridged = Boolean(window.gmatch?.mediaqInstall);
  const installing = mediaq.status === 'installing';
  const installed = Boolean(status?.installed) || mediaq.status === 'done';
  const running = Boolean(status?.running);

  const install = () => {
    toast?.('Installing the media suite — progress stays visible in Notifications.', 'info');
    // Inline install: no modal pops over Settings, but the shared store still
    // drives the notification centre and the first-run setup modal.
    mediaq.start(false);
  };

  const runAction = async (action: ServerAction) => {
    if (busy) return;
    setBusy(action);
    const g = window.gmatch;
    try {
      if (action === 'start') {
        const res = await g?.mediaqStart?.();
        if (res?.ok) toast?.('Media suite is running — the clicker will use it on the next fetch.', 'success');
        else toast?.(res?.error ? `Could not start the media suite: ${res.error}` : 'Could not start the media suite', 'error');
      } else if (action === 'stop') {
        const res = await g?.mediaqStop?.();
        if (res?.ok) toast?.('Media suite stopped. Local sources are still available.', 'success');
        else if (res?.error === 'still-running') toast?.('Still running — this server was started outside the app.', 'warning');
        else toast?.(res?.error ? `Could not stop the media suite: ${res.error}` : 'Could not stop the media suite', 'error');
      } else {
        const res = await g?.mediaqRestart?.();
        if (res?.ok) toast?.('Media suite restarted.', 'success');
        else toast?.(res?.error ? `Could not restart the media suite: ${res.error}` : 'Could not restart the media suite', 'error');
      }
    } catch {
      toast?.(`Could not ${action} the media suite`, 'error');
    } finally {
      setBusy(null);
      await probeStatus();
    }
  };

  const actionButton = (action: ServerAction, label: string, busyLabel: string, Icon: typeof Play) => (
    <button
      type="button"
      onClick={() => void runAction(action)}
      disabled={busy !== null}
      aria-busy={busy === action}
      className={buttonClass(action === 'start' ? 'primary' : 'secondary', 'sm')}
    >
      <Icon className={ICON.sm} />
      {busy === action ? busyLabel : label}
    </button>
  );

  return (
    <div className={`${PADDING[4]} bg-glass-w5 border border-edge rounded-lg space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <span className={classes(TYPE.caption, WEIGHT.medium, TRACKING.wider, COLOR.muted, 'uppercase')}>
          Media suite <span className="normal-case tracking-normal">(optional)</span>
        </span>
        <Sparkles className={classes(ICON.md, installed ? STATUS.success : COLOR.muted)} />
      </div>

      <p className={`${TYPE.body} text-retro-body`}>
        Adds real and hentai picture sources to the clicker. It installs once on
        this device (a small Python manager plus mediaq) and runs locally. The
        app works fully offline without it.
      </p>

      {!bridged && (
        <p className={`${TYPE.caption} ${COLOR.muted}`}>
          Desktop app only. The browser build keeps its local sources and ignores this section.
        </p>
      )}

      {bridged && installed && !installing && (
        <p className={classes('flex items-center', GAP[1.5], TYPE.caption, running ? STATUS.success : STATUS.warning)}>
          {running ? <CheckCircle2 className={ICON.sm} /> : <AlertCircle className={ICON.sm} />}
          {running
            ? 'Installed and running — used automatically by the clicker.'
            : status?.error
              ? `Installed. Status check failed: ${status.error}`
              : 'Installed. Start the local server to use it in the clicker.'}
        </p>
      )}

      {bridged && installed && !installing && (
        <div className={classes('flex flex-wrap items-center', GAP[2])}>
          {!running && actionButton('start', 'Start media suite', 'Starting…', Play)}
          {running && actionButton('stop', 'Stop media suite', 'Stopping…', Square)}
          {running && actionButton('restart', 'Restart media suite', 'Restarting…', RotateCcw)}
        </div>
      )}

      {installing && (
        <div className="space-y-1.5" role="status" aria-live="polite">
          <div className={`h-2 w-full overflow-hidden rounded-full ${COLOR.glassW8}`}>
            {mediaq.percent !== null ? (
              <div
                className={classes('h-full rounded-full bg-retro-accent', MOTION.transition.width)}
                style={{ width: `${mediaq.percent}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-retro-accent" />
            )}
          </div>
          <div className={`flex justify-between ${TYPE.caption} ${COLOR.muted}`}>
            <span className="truncate">{mediaq.message || 'Installing…'}</span>
            {mediaq.percent !== null && <span className={MONO}>{mediaq.percent}%</span>}
          </div>
          <div className={classes('flex flex-wrap', GAP[2], 'pt-1')}>
            <button
              type="button"
              onClick={() => { onClose?.(); }}
              className={buttonClass('secondary', 'sm')}
            >
              Send to background
            </button>
            <button
              type="button"
              onClick={() => mediaq.cancel()}
              className={buttonClass('danger', 'sm')}
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
            onClick={install}
            className={buttonClass('primary', 'sm')}
          >
            <Download className={ICON.sm} />
            {mediaq.status === 'error' || mediaq.status === 'cancelled' ? 'Retry install' : 'Install media suite'}
          </button>
          <span className={`${TYPE.caption} ${COLOR.muted}`}>First run downloads ~100 MB and never leaves this device.</span>
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
