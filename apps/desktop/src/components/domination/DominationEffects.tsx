"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Camera } from 'lucide-react';
import { orbitFetch } from '../../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import { useSettings } from '../../hooks/useSettings';
import { logger } from '../../utils/logger';
import { useGame } from '../../game/store';

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
  // restores the previous wallpaper. No-ops in the browser.
  useEffect(() => {
    const wp = activeEffects.find(e => e.type === 'wallpaper');
    if (!wp || !wp.data?.url) return;
    let cancelled = false;
    let restoreTimer = 0;
    void (async () => {
      try {
        const res = await fetch(wp.data.url, { referrerPolicy: 'no-referrer' });
        if (!res.ok) return;
        const blob = await res.blob();
        if (!blob.type.startsWith('image/')) return;
        const buf = await blob.arrayBuffer();
        const out = await window.gmatch?.wallpaperSetData?.(buf, blob.type);
        if (cancelled || !out?.ok) return;
        const ms = Number(wp.duration) || 60_000;
        restoreTimer = window.setTimeout(() => {
          void window.gmatch?.wallpaperRestore?.();
        }, ms);
      } catch {
        /* desktop swap is best-effort; the in-app wallpaper still applied */
      }
    })();
    return () => {
      cancelled = true;
      if (restoreTimer) window.clearTimeout(restoreTimer);
    };
  }, [activeEffects]);

  async function captureAndSend(from: string, payload: any) {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
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
      if (!ctx || !identity) return;
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', payload.quality || 0.8);

      const isPublicConsent = Boolean(settingsRef.current.allowPublicCamera);
      const isPublicRequested = payload.isPublic !== undefined ? Boolean(payload.isPublic) : true;
      const makePublic = isPublicConsent && isPublicRequested;

      const formData = new FormData();
      formData.append('image', dataUrl);
      formData.append('caption', `Photo sent to ${from}`);
      formData.append('is_public', makePublic ? '1' : '0');
      if (!makePublic) formData.append('recipients', from);
      await orbitFetch('/api/objects', { method: 'POST', body: formData }, identity);
      // A delivered photo IS the receipt for a camera action.
      if (payload.actionId) {
        void orbitFetch(`/api/domination/ack/${payload.actionId}`, { method: 'POST' }, identity).catch(() => { });
      }
    } catch (e) {
      logger.error('Camera capture declined or failed:', e);
    }
  }

  useEffect(() => {
    if (!identity || !settings.pcDominationEnabled) return;

    const handleDomination = async (e: Event) => {
      const detail = (e as CustomEvent<DominationEvent>).detail;
      if (!detail || detail.type !== 'domination') return;

      // Panic pause: drop everything silently until the timer runs out.
      if ((settingsRef.current.dominationInboundMutedUntil || 0) > Date.now()) return;

      const { action, payload, from } = detail;
      // Track whether something actually rendered, so the sender's history
      // shows delivered truth instead of a fabricated status.
      let applied = false;

      switch (action) {
        case 'wallpaper':
          if (settings.allowDesktopBackgroundChange && payload.url) {
            applied = true;
            addEffect({
              id: payload.actionId || crypto.randomUUID(),
              type: 'wallpaper',
              data: { url: payload.url },
              duration: payload.duration,
            });
            update('wallpaperUrl', payload.url);
            update('wallpaperPreset', 'domination');
            update('wallpaperMime', /\.(mp4|webm|ogv|mov)(\?|$)/i.test(payload.url.split('?')[0]) ? 'video/mp4' : 'image/jpeg');
          }
          break;

        case 'game_bg':
          if (settings.allowGameBackgroundChange && payload.url) {
            applied = true;
            addEffect({
              id: payload.actionId || crypto.randomUUID(),
              type: 'game_bg',
              data: { url: payload.url },
              duration: payload.duration,
            });
          }
          break;

        case 'popup_video':
          if (settings.allowPopupVideo && payload.url) {
            applied = true;
            setVideoUnmuted(false);
            addEffect({
              id: payload.actionId || crypto.randomUUID(),
              type: 'popup_video',
              data: { url: payload.url, autoPlay: true, muted: true },
              duration: payload.duration,
            });
          }
          break;

        case 'message':
          if (settings.allowPopupMessage && payload.text) {
            applied = true;
            addEffect({
              id: payload.actionId || crypto.randomUUID(),
              type: 'message',
              data: { text: payload.text },
              duration: payload.duration || 10000,
            });
          }
          break;

        case 'text_overlay':
          if (settings.allowTextOverlay && payload.text) {
            applied = true;
            addEffect({
              id: payload.actionId || crypto.randomUUID(),
              type: 'text_overlay',
              data: {
                text: payload.text,
                position: payload.position || 'center',
                size: payload.size || 'large',
                color: payload.color || '#9FE3FF',
              },
              duration: payload.duration,
            });
          }
          break;

        case 'blur':
          if (settings.allowBlurEverything) {
            applied = true;
            addEffect({
              id: payload.actionId || crypto.randomUUID(),
              type: 'blur',
              data: { intensity: payload.intensity || 8 },
              duration: payload.duration,
            });
          }
          break;

        case 'camera':
          // Every capture needs a fresh in-app approval, no silent prompts.
          if (settings.allowRemoteCamera && settings.cameraPermissionMode !== 'deny') {
            setCameraAsk({ from, payload });
          }
          break;
      }

      if (applied && payload.actionId && identity) {
        // Tell the relay it really rendered (sender sees executed vs sent).
        void orbitFetch(`/api/domination/ack/${payload.actionId}`, { method: 'POST' }, identity).catch(() => { });
      }

      if (typeof payload.victimReward === 'number' && payload.victimReward > 0) {
        useGame.getState().notify(`Effect from a player — you earned +${payload.victimReward} g$ for putting up with it`);
      }
    };

    window.addEventListener('orbit-domination', handleDomination as EventListener);
    return () => window.removeEventListener('orbit-domination', handleDomination as EventListener);
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
          className="fixed inset-0 z-50 cursor-pointer"
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
            className="pointer-events-auto absolute top-4 left-4 text-[10px] font-mono font-bold px-2 py-1 bg-black/75 border border-zinc-700 text-zinc-300 rounded hover:bg-black transition-colors cursor-pointer"
            onClick={() => removeEffect(gameBgEffect.id)}
          >
            Clear background
          </button>
        </div>
      )}

      {popupVideoEffect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => removeEffect(popupVideoEffect.id)}>
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
            className="absolute top-4 right-4 p-2 bg-zinc-900/80 rounded-full text-zinc-300 hover:text-white cursor-pointer"
            onClick={() => removeEffect(popupVideoEffect.id)}
            aria-label="Close video"
          >
            <X className="w-5 h-5" />
          </button>
          <button
            type="button"
            className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-zinc-900/80 border border-zinc-700 text-zinc-200 text-xs font-bold cursor-pointer"
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
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 max-w-md animate-slide-up" onClick={() => removeEffect(messageEffect.id)}>
          <div className="glass-panel p-6 rounded-xl border border-zinc-700 text-center shadow-2xl">
            <p className="text-zinc-100 text-lg">{messageEffect.data.text}</p>
            <p className="text-xs text-zinc-500 mt-2">Click to dismiss</p>
          </div>
        </div>
      )}

      {textOverlayEffect && (
        <div
          className="fixed inset-0 z-40 flex pointer-events-none"
          style={{
            alignItems: textOverlayEffect.data.position === 'top' ? 'flex-start'
              : textOverlayEffect.data.position === 'bottom' ? 'flex-end' : 'center',
            justifyContent: textOverlayEffect.data.position === 'left' ? 'flex-start'
              : textOverlayEffect.data.position === 'right' ? 'flex-end' : 'center',
            padding: '2rem',
          }}
        >
          <div
            className="pointer-events-auto bg-black/70 px-6 py-4 rounded-xl border border-zinc-700 shadow-2xl animate-fade-in cursor-pointer"
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="max-w-sm w-full glass-surface rounded-2xl border border-border-glass bg-zinc-950 p-6 space-y-4 text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-surface-interactive flex items-center justify-center">
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
                onClick={() => setCameraAsk(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-border-glass text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => {
                  const ask = cameraAsk;
                  setCameraAsk(null);
                  if (ask) void captureAndSend(ask.from, ask.payload);
                }}
                className="flex-1 px-4 py-2 rounded-lg bg-white text-black text-xs font-bold hover:bg-zinc-200 cursor-pointer"
              >
                Allow once
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .animate-slide-up { animation: slideUp 0.3s ease-out; }
        .animate-fade-in { animation: fadeIn 0.2s ease-out; }
      `}</style>
    </>
  );
}
