"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Camera } from 'lucide-react';
import { orbitFetch } from '../../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import { useSettings } from '../../hooks/useSettings';
import { logger } from '../../utils/logger';
import { useGame } from '../../game/store';
import { validateDomPayload } from '../../utils/dominationMesh';

interface DominationEvent {
  type: 'domination';
  action: 'wallpaper' | 'game_bg' | 'popup_video' | 'message' | 'text_overlay' | 'blur' | 'camera';
  from: string;
  payload: {
    url?: string;
    text?: string;
    intensity?: number;
    duration?: number;
    quality?: number;
    position?: string;
    size?: string;
    color?: string;
    actionId?: string;
    intensityPreset?: string;
    isPublic?: boolean;
    /** Mesh request id (mesh path) — the execution receipt keys on it. */
    meshId?: string;
    /** Sealed sender display name (mesh path). */
    senderName?: string;
    /** g$ the victim just earned from the consent cut (server-paid). */
    victimReward?: number;
  };
  timestamp: string;
}

interface ActiveEffect {
  id: string;
  type: 'wallpaper' | 'game_bg' | 'popup_video' | 'message' | 'text_overlay' | 'blur';
  data: any;
  startTime: number;
  duration?: number;
}

/**
 * Renders inbound domination effects for the player who opted in.
 * Safety rules: every effect is dismissed by Esc or a visible close control,
 * videos start muted, camera asks before capturing, and the 15-minute
 * inbound pause (settings.dominationInboundMutedUntil) drops everything.
 */
export function DominationEffects({ identity }: { identity: OrbitIdentity | null }) {
  const { settings, update } = useSettings();
  const [activeEffects, setActiveEffects] = useState<ActiveEffect[]>([]);
  const [cameraAsk, setCameraAsk] = useState<{ from: string; payload: any } | null>(null);
  const [videoUnmuted, setVideoUnmuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const clearAll = useCallback(() => {
    setActiveEffects([]);
    setCameraAsk(null);
    setVideoUnmuted(false);
  }, []);

  const addEffect = useCallback((effect: Omit<ActiveEffect, 'startTime'>) => {
    const newEffect = { ...effect, startTime: Date.now() };
    setActiveEffects(prev => [...prev, newEffect]);

    if (effect.duration) {
      setTimeout(() => {
        setActiveEffects(prev => prev.filter(e => e.id !== effect.id));
      }, effect.duration);
    }
  }, []);

  const removeEffect = useCallback((id: string) => {
    setActiveEffects(prev => prev.filter(e => e.id !== id));
  }, []);

  // Esc clears whatever is on screen. Panic event from the Domination tab
  // does the same and additionally drops the in-app wallpaper swap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearAll();
    };
    const onPanic = () => {
      clearAll();
      update('wallpaperPreset', 'default');
      update('wallpaperUrl', '');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('gmatch:domination-panic', onPanic);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('gmatch:domination-panic', onPanic);
    };
  }, [clearAll, update]);

  // OS-level wallpaper swap (Windows). Applies for the effect duration, then
  // restores the previous wallpaper. No-ops in the browser. The OS swap is a
  // HIGH-IMPACT tier with its own consent (allowDesktopWallpaperOS) — the
  // in-app swap alone does not unlock it. The execution outcome reported to
  // the sender is the OS result when the tier is on: a consented-but-failed
  // swap reports failed, never a fabricated success.
  useEffect(() => {
    const wp = activeEffects.find(e => e.type === 'wallpaper');
    if (!wp || !wp.data?.url) return;
    let cancelled = false;
    let restoreTimer = 0;
    let reported = false;
    const report = (ok: boolean) => {
      if (reported) return;
      reported = true;
      if (wp.id.startsWith('dom-')) {
        // Mesh path: the manager seals completed/failed to the sender.
        window.dispatchEvent(new CustomEvent('gmatch:domination-executed', { detail: { id: wp.id, ok } }));
      } else if (identity) {
        // Server path: the ack records executed vs failed in the ledger.
        void orbitFetch(`/api/domination/ack/${wp.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok }),
        }, identity).catch(() => { });
      }
    };
    void (async () => {
      try {
        const bridge = window.gmatch?.wallpaperSetData;
        const osTier = Boolean(settingsRef.current.allowDesktopWallpaperOS) && Boolean(bridge);
        const res = await fetch(wp.data.url, { referrerPolicy: 'no-referrer' });
        if (!res.ok) {
          report(!osTier); // in-app swap may still render via the URL
          return;
        }
        const blob = await res.blob();
        if (!blob.type.startsWith('image/') || blob.size > 25 * 1024 * 1024) {
          report(!osTier);
          return;
        }
        if (cancelled) { report(true); return; }
        const buf = await blob.arrayBuffer();
        if (!osTier || !bridge) {
          report(true); // in-app wallpaper executed; OS tier not consented
          return;
        }
        const out = await bridge(buf, blob.type);
        if (cancelled) {
          if (out?.ok) void window.gmatch?.wallpaperRestore?.();
          report(true); // the in-app effect did render
          return;
        }
        report(Boolean(out?.ok));
        if (!out?.ok) return;
        const ms = Number(wp.duration) || 60_000;
        restoreTimer = window.setTimeout(() => {
          void window.gmatch?.wallpaperRestore?.();
        }, ms);
      } catch {
        report(false); // fetch blew up: no in-app wallpaper, no OS swap
      }
    })();
    return () => {
      cancelled = true;
      if (restoreTimer) window.clearTimeout(restoreTimer);
    };
  }, [activeEffects]);

  async function captureAndSend(from: string, payload: any) {
    const meshId = typeof payload?.meshId === 'string' ? payload.meshId : undefined;
    const actionId = typeof payload?.actionId === 'string' ? payload.actionId : undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API');
      // Consume the one-shot desktop permission before prompting the camera.
      await window.gmatch?.grantCameraOnce?.();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise<void>((resolve) => { video.onloadeddata = () => resolve(); });

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      stream.getTracks().forEach(t => t.stop());
      if (!ctx || !identity) throw new Error('capture unavailable');
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', payload?.quality || 0.8);

      const isPublicConsent = Boolean(settingsRef.current.allowPublicCamera);
      const isPublicRequested = payload?.isPublic !== undefined ? Boolean(payload.isPublic) : true;
      const makePublic = isPublicConsent && isPublicRequested;

      if (meshId) {
        // Mesh path: the frame itself is the delivery — sealed straight back
        // to the requester (no server media store, works between couriers).
        // The completed receipt fires only after this seal succeeds.
        window.dispatchEvent(new CustomEvent('gmatch:domination-photo-captured', { detail: { id: meshId, dataUrl } }));
        return;
      }

      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], `domination-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const { forgeMediaLocally } = await import('../../services/mediaForge');
      await forgeMediaLocally(file, identity, {
        caption: `Photo sent to ${from}`,
        isPublic: makePublic,
        recipients: !makePublic ? from : undefined,
      });
      // A delivered photo IS the receipt for a camera action.
      if (actionId) {
        void orbitFetch(`/api/domination/ack/${actionId}`, { method: 'POST' }, identity).catch(() => { });
      }
    } catch (e) {
      logger.error('Camera capture declined or failed:', e);
      if (meshId) {
        // The sender must not see "completed" for an approved-but-undelivered
        // photo: report the failure through the execution channel.
        window.dispatchEvent(new CustomEvent('gmatch:domination-executed', { detail: { id: meshId, ok: false } }));
      }
    }
  }

  // Mesh camera decision (Fase 5/6): the courier hook seals the receipt back
  // (landed | declined) keyed on the mesh request id. Server-path payloads
  // carry no meshId and skip this entirely (their ack is the /ack POST).
  const meshCameraDecision = (approved: boolean, meshId?: string) => {
    if (!meshId) return;
    window.dispatchEvent(new CustomEvent('gmatch:domination-camera-decision', {
      detail: { id: meshId, approved },
    }));
  };

  useEffect(() => {
    if (!identity || !settings.pcDominationEnabled) return;

    const handleDomination = async (e: Event) => {
      const detail = (e as CustomEvent<DominationEvent>).detail;
      if (!detail || detail.type !== 'domination') return;

      // Panic pause: drop everything silently until the timer runs out.
      if ((settingsRef.current.dominationInboundMutedUntil || 0) > Date.now()) return;

      const { action, payload, from } = detail;
      // The mesh request id (mesh path) or the server actionId (relay path).
      const requestId = (payload?.meshId as string | undefined) || payload?.actionId;
      // Execution truth: the sender's outbox distinguishes delivered from
      // executed, so every path below reports what actually happened.
      const reportExecuted = (ok: boolean) => {
        if (!requestId) return;
        if (payload?.meshId) {
          window.dispatchEvent(new CustomEvent('gmatch:domination-executed', { detail: { id: payload.meshId, ok } }));
        }
        // Server path: the ack POST below marks executed; failures stay honest
        // by NOT acking (the server route also accepts an explicit failure).
      };
      // Defense in depth: the mesh manager already clamps, but the server
      // relay path delivers raw sender payloads — validate here for both.
      const checked = validateDomPayload(action, payload);
      if (!checked.ok) {
        logger.warn(`Domination ${action} rejected: ${checked.reason}`);
        reportExecuted(false);
        return;
      }
      const p = checked.payload as Record<string, unknown>;
      // Track whether something actually rendered, so the sender's history
      // shows delivered truth instead of a fabricated status.
      let applied = false;

      switch (action) {
        case 'wallpaper':
          if (settings.allowDesktopBackgroundChange && typeof p.url === 'string') {
            applied = true;
            addEffect({
              id: (requestId as string) || crypto.randomUUID(),
              type: 'wallpaper',
              data: { url: p.url },
              duration: p.duration as number | undefined,
            });
            update('wallpaperUrl', p.url);
            update('wallpaperPreset', 'domination');
            update('wallpaperMime', /\.(mp4|webm|ogv|mov)(\?|$)/i.test(String(p.url).split('?')[0]) ? 'video/mp4' : 'image/jpeg');
            // The OS swap (and its execution report) happens in the dedicated
            // effect below — it is the part that can genuinely fail.
          }
          break;

        case 'game_bg':
          if (settings.allowGameBackgroundChange && typeof p.url === 'string') {
            applied = true;
            addEffect({
              id: (requestId as string) || crypto.randomUUID(),
              type: 'game_bg',
              data: { url: p.url },
              duration: p.duration as number | undefined,
            });
          }
          break;

        case 'popup_video':
          if (settings.allowPopupVideo && typeof p.url === 'string') {
            applied = true;
            setVideoUnmuted(false);
            addEffect({
              id: (requestId as string) || crypto.randomUUID(),
              type: 'popup_video',
              data: { url: p.url, autoPlay: true, muted: true },
              duration: p.duration as number | undefined,
            });
          }
          break;

        case 'message':
          if (settings.allowPopupMessage && typeof p.text === 'string') {
            applied = true;
            addEffect({
              id: (requestId as string) || crypto.randomUUID(),
              type: 'message',
              data: { text: p.text },
              duration: (p.duration as number) || 10000,
            });
            // Native toast (works while minimized, Windows Action Center).
            void window.gmatch?.nativeNotify?.('gMatch message', p.text);
          }
          break;

        case 'text_overlay':
          if (settings.allowTextOverlay && typeof p.text === 'string') {
            applied = true;
            addEffect({
              id: (requestId as string) || crypto.randomUUID(),
              type: 'text_overlay',
              data: {
                text: p.text,
                position: (p.position as string) || 'center',
                size: (p.size as string) || 'large',
                color: (p.color as string) || '#9FE3FF',
              },
              duration: p.duration as number | undefined,
            });
            void window.gmatch?.nativeNotify?.('gMatch banner', p.text);
          }
          break;

        case 'blur':
          if (settings.allowBlurEverything) {
            applied = true;
            addEffect({
              id: (requestId as string) || crypto.randomUUID(),
              type: 'blur',
              data: { intensity: (p.intensity as number) || 8 },
              duration: p.duration as number | undefined,
            });
          }
          break;

        case 'camera':
          // Every capture needs a fresh in-app approval, no silent prompts.
          if (settings.allowRemoteCamera && settings.cameraPermissionMode !== 'deny') {
            // The envelope ids ride OUTSIDE the validated payload — they are
            // routing, not effect content, and must survive the schema strip.
            setCameraAsk({
              from,
              payload: {
                ...p,
                meshId: payload?.meshId as string | undefined,
                actionId: payload?.actionId as string | undefined,
              },
            });
          }
          break;
      }

      if (applied) {
        // Non-wallpaper effects executed the moment they rendered. Wallpaper
        // reports from the OS-swap effect below (it can genuinely fail).
        if (action !== 'wallpaper') reportExecuted(true);
        if (payload?.actionId && identity && action !== 'wallpaper') {
          void orbitFetch(`/api/domination/ack/${payload.actionId}`, { method: 'POST' }, identity).catch(() => { });
        }
      } else if (requestId && action !== 'camera') {
        // Camera is intentionally not reported here: rendering the approval
        // ask is not an outcome — captureAndSend / decline report it.
        reportExecuted(false);
        if (payload?.actionId && identity) {
          // Server path failure: record it instead of leaving a 'sent' row.
          void orbitFetch(`/api/domination/ack/${payload.actionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: false }),
          }, identity).catch(() => { });
        }
      }

      if (typeof payload?.victimReward === 'number' && payload.victimReward > 0) {
        useGame.getState().notify(`Effect from a player. You earned +${payload.victimReward} g$ for putting up with it`);
      }
    };

    window.addEventListener('orbit-domination', handleDomination as EventListener);
    // Mesh inbound (Fase 5/6): sealed dom_request bodies arrive via the
    // courier hook as 'gmatch:domination-mesh-effect'. Reuse the server path
    // 1:1 — same consent gates, same panic pause, same rendering. Only the
    // id source differs: the mesh request id rides as payload.meshId (no
    // server actionId, no ledger, no victim payout).
    const handleMeshEffect = (e: Event) => {
      const d = (e as CustomEvent<{
        action?: string;
        from?: string;
        senderName?: string;
        payload?: any;
        meshId?: string;
      }>).detail;
      if (!d || typeof d.action !== 'string') return;
      void handleDomination(new CustomEvent('orbit-domination', {
        detail: {
          type: 'domination',
          action: d.action,
          // `from` stays the sender orbit id (camera forging addresses it);
          // the sealed display name rides alongside for rendering.
          payload: { ...(d.payload ?? {}), meshId: d.meshId, senderName: d.senderName },
          from: d.from,
        },
      }) as Event);
    };
    window.addEventListener('gmatch:domination-mesh-effect', handleMeshEffect);
    return () => {
      window.removeEventListener('orbit-domination', handleDomination as EventListener);
      window.removeEventListener('gmatch:domination-mesh-effect', handleMeshEffect);
    };
  }, [identity, settings, addEffect, update]);

  const blurEffect = activeEffects.find(e => e.type === 'blur');
  const gameBgEffect = activeEffects.find(e => e.type === 'game_bg');
  const popupVideoEffect = activeEffects.find(e => e.type === 'popup_video');
  const messageEffect = activeEffects.find(e => e.type === 'message');
  const textOverlayEffect = activeEffects.find(e => e.type === 'text_overlay');

  return (
    <>
      {blurEffect && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] cursor-pointer"
          style={{
            backdropFilter: `blur(${blurEffect.data.intensity}px)`,
            backgroundColor: 'rgba(0,0,0,0.1)',
          }}
          onClick={() => removeEffect(blurEffect.id)}
          role="button"
          aria-label="Clear blur"
        />
      )}

      {gameBgEffect && (
        <div
          className="fixed inset-0 z-30 pointer-events-none overflow-hidden"
          style={{ animation: 'fadeIn 0.3s ease-out' }}
        >
          {/\.(mp4|webm|ogv|mov)(\?|$)/i.test(gameBgEffect.data.url.split('?')[0]) ? (
            <video
              src={gameBgEffect.data.url}
              autoPlay
              loop
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full bg-cover bg-center"
              style={{ backgroundImage: `url(${gameBgEffect.data.url})` }}
            />
          )}
          <div className="absolute inset-0 bg-black/40 pointer-events-none" />
          <button
            type="button"
            className="pointer-events-auto absolute top-4 left-4 text-[10px] font-mono font-bold px-2 py-1 bg-black/75 border border-border-glass text-retro-fg rounded hover:bg-black transition-colors cursor-pointer"
            onClick={() => removeEffect(gameBgEffect.id)}
          >
            Clear background
          </button>
        </div>
      )}

      {popupVideoEffect && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/70" onClick={() => removeEffect(popupVideoEffect.id)}>
          <video
            ref={videoRef}
            src={popupVideoEffect.data.url}
            autoPlay
            loop
            muted={!videoUnmuted}
            playsInline
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="absolute top-4 right-4 p-2 bg-retro-panel/80 rounded-full text-retro-fg hover:text-white cursor-pointer"
            onClick={() => removeEffect(popupVideoEffect.id)}
            aria-label="Close video"
          >
            <X className="w-5 h-5" />
          </button>
          <button
            type="button"
            className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-retro-panel/80 border border-border-glass text-retro-fg text-xs font-bold cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setVideoUnmuted((v) => {
                const next = !v;
                if (videoRef.current) videoRef.current.muted = !next;
                return next;
              });
            }}
          >
            {videoUnmuted ? 'Mute' : 'Unmute'}
          </button>
        </div>
      )}

      {messageEffect && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 max-w-md animate-domination-toast-up" onClick={() => removeEffect(messageEffect.id)}>
          <div className="glass-panel p-6 rounded-xl border border-border-glass text-center shadow-2xl">
            <p className="text-retro-fg text-lg">{messageEffect.data.text}</p>
            <p className="text-xs text-retro-muted mt-2">Click to dismiss</p>
          </div>
        </div>
      )}

      {textOverlayEffect && (
        <div
          className="fixed inset-0 z-[var(--z-dropdown)] flex pointer-events-none"
          style={{
            alignItems: textOverlayEffect.data.position === 'top' ? 'flex-start'
              : textOverlayEffect.data.position === 'bottom' ? 'flex-end' : 'center',
            justifyContent: textOverlayEffect.data.position === 'left' ? 'flex-start'
              : textOverlayEffect.data.position === 'right' ? 'flex-end' : 'center',
            padding: '2rem',
          }}
        >
          <div
            className="pointer-events-auto bg-black/70 px-6 py-4 rounded-xl border border-border-glass shadow-2xl animate-orbit-fade-in cursor-pointer"
            style={{
              fontSize: textOverlayEffect.data.size === 'small' ? '1.5rem'
                : textOverlayEffect.data.size === 'medium' ? '3rem' : '5rem',
              color: textOverlayEffect.data.color,
              fontWeight: '900',
              textShadow: '0 0 20px currentColor, 0 0 40px currentColor',
              maxWidth: '90vw',
              wordBreak: 'break-word',
              textAlign: 'center',
            }}
            onClick={() => removeEffect(textOverlayEffect.id)}
          >
            {textOverlayEffect.data.text}
          </div>
        </div>
      )}

      {cameraAsk && (
        <div className="fixed inset-0 z-[var(--z-lightbox)] flex items-center justify-center bg-black/70 p-4">
          <div className="max-w-sm w-full glass-surface rounded-xl border border-border-glass bg-retro-bg p-6 space-y-4 text-center">
            <div className="w-12 h-12 mx-auto rounded-xl bg-surface-interactive flex items-center justify-center">
              <Camera className="w-6 h-6 text-retro-fg" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-retro-fg">{cameraAsk.from} is asking for a photo</h3>
              <p className="text-xs text-retro-muted mt-1 leading-relaxed">
                Your camera turns on for one frame, and the photo goes to them. Nothing is captured unless you allow it.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const ask = cameraAsk;
                  setCameraAsk(null);
                  if (!ask) return;
                  // Decline IS an outcome for both transports.
                  meshCameraDecision(false, ask.payload?.meshId);
                  if (ask.payload?.actionId && identity) {
                    void orbitFetch(`/api/domination/ack/${ask.payload.actionId}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ok: false }),
                    }, identity).catch(() => { });
                  }
                }}
                className="flex-1 px-4 py-2 rounded-lg border border-border-glass text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => {
                  const ask = cameraAsk;
                  setCameraAsk(null);
                  if (ask) {
                    // Approval alone is not success: the receipt fires when
                    // the frame is delivered (or fails) inside captureAndSend.
                    void captureAndSend(ask.from, ask.payload);
                  }
                }}
                className="flex-1 px-4 py-2 rounded-lg bg-white text-black text-xs font-bold hover:bg-retro-fg cursor-pointer"
              >
                Allow once
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes domination-toast-up {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .animate-domination-toast-up { animation: domination-toast-up 0.3s ease-out; }
      `}</style>
    </>
  );
}
