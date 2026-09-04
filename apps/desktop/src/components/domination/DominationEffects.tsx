"use client";

import { useEffect, useState, useCallback } from 'react';
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

export function DominationEffects({ identity }: { identity: OrbitIdentity | null }) {
  const { settings, update } = useSettings();
  const [activeEffects, setActiveEffects] = useState<ActiveEffect[]>([]);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

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

  async function handleCameraRequest(from: string, payload: any) {
    if (!navigator.mediaDevices?.getUserMedia) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      setCameraStream(stream);

      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();

      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
      });

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', payload.quality || 0.8);
        
        stream.getTracks().forEach(t => t.stop());
        setCameraStream(null);

        if (identity) {
          try {
            // Check if user (victim) allows public camera and if dominator requested public or private
            const isPublicConsent = Boolean(settings.allowPublicCamera);
            const isPublicRequested = payload.isPublic !== undefined ? Boolean(payload.isPublic) : true;
            const makePublic = isPublicConsent && isPublicRequested;

            const formData = new FormData();
            formData.append('image', dataUrl);
            formData.append('caption', `Camera capture from domination request by ${from}`);
            formData.append('is_public', makePublic ? '1' : '0');
            if (!makePublic) {
              formData.append('recipients', from);
            }

            await orbitFetch('/api/objects', {
              method: 'POST',
              body: formData,
            }, identity);
          } catch {}
        }
      }
    } catch (e) {
      logger.error('Camera request failed:', e);
    }
  }

  useEffect(() => {
    if (!identity || !settings.pcDominationEnabled) return;

    const handleDomination = async (e: Event) => {
      const detail = (e as CustomEvent<DominationEvent>).detail;
      if (!detail || detail.type !== 'domination') return;

      const { action, payload, from } = detail;

      switch (action) {
        case 'wallpaper':
          if (settings.allowDesktopBackgroundChange && payload.url) {
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
            addEffect({
              id: payload.actionId || crypto.randomUUID(),
              type: 'popup_video',
              data: { url: payload.url, autoPlay: true, muted: false },
              duration: payload.duration,
            });
          }
          break;

        case 'message':
          if (settings.allowPopupMessage && payload.text) {
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
            addEffect({
              id: payload.actionId || crypto.randomUUID(),
              type: 'blur',
              data: { intensity: payload.intensity || 8 },
              duration: payload.duration,
            });
          }
          break;

        case 'camera':
          if (settings.allowRemoteCamera && settings.cameraPermissionMode !== 'deny') {
            await handleCameraRequest(from, payload);
          }
          break;
      }

      // Consent-cut payout: the ledger credit lands on the next reconcile;
      // tell the player NOW so the loop feels connected.
      if (typeof payload.victimReward === 'number' && payload.victimReward > 0) {
        useGame.getState().notify(`You were ${action.replace('_', ' ')}d — consent cut +${payload.victimReward} g$`);
      }
    };

    window.addEventListener('orbit-domination', handleDomination as EventListener);
    return () => window.removeEventListener('orbit-domination', handleDomination as EventListener);
  }, [identity, settings, addEffect]);

  const blurEffect = activeEffects.find(e => e.type === 'blur');
  const wallpaperEffect = activeEffects.find(e => e.type === 'wallpaper');
  const gameBgEffect = activeEffects.find(e => e.type === 'game_bg');
  const popupVideoEffect = activeEffects.find(e => e.type === 'popup_video');
  const messageEffect = activeEffects.find(e => e.type === 'message');
  const textOverlayEffect = activeEffects.find(e => e.type === 'text_overlay');

  return (
    <>
      {blurEffect && (
        <div
          className="fixed inset-0 z-50 pointer-events-none"
          style={{ 
            backdropFilter: `blur(${blurEffect.data.intensity}px)`,
            backgroundColor: 'rgba(0,0,0,0.1)',
            animation: 'fadeIn 0.3s ease-out',
          }}
          onClick={() => removeEffect(blurEffect.id)}
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
            className="pointer-events-auto absolute top-4 left-4 text-[10px] font-mono font-bold px-2 py-1 bg-black/75 border border-purple-500/40 text-purple-300 rounded hover:bg-black transition-colors"
            onClick={() => removeEffect(gameBgEffect.id)}
          >
            Clear Game BG
          </button>
        </div>
      )}

      {popupVideoEffect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => removeEffect(popupVideoEffect.id)}>
          <video
            src={popupVideoEffect.data.url}
            autoPlay
            loop
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button 
            className="absolute top-4 right-4 p-2 bg-zinc-900/80 rounded-full text-zinc-300 hover:text-white"
            onClick={() => removeEffect(popupVideoEffect.id)}
          >
            ✕
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
          className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none"
          style={{
            display: 'flex',
            alignItems: textOverlayEffect.data.position === 'top' ? 'flex-start' : 
                       textOverlayEffect.data.position === 'bottom' ? 'flex-end' : 'center',
            justifyContent: textOverlayEffect.data.position === 'left' ? 'flex-start' : 
                           textOverlayEffect.data.position === 'right' ? 'flex-end' : 'center',
            padding: '2rem',
          }}
        >
          <div
            className="pointer-events-auto bg-black/70 px-6 py-4 rounded-xl border border-zinc-700 shadow-2xl animate-fade-in"
            style={{
              fontSize: textOverlayEffect.data.size === 'small' ? '1.5rem' : 
                       textOverlayEffect.data.size === 'medium' ? '3rem' : '5rem',
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