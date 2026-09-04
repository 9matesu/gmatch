"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { playPress, playLike } from '../../utils/sounds';
import { Camera, X, RefreshCw, Check, AlertCircle, Upload } from 'lucide-react';
import { logger } from '../../utils/logger';

export function LiveCameraModal({
  isOpen,
  onClose,
  onCapture,
  toast,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (imageDataUrl: string) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      streamRef.current = null;
      setStream(null);
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopStream();
    setIsStarting(true);
    setCameraError(null);

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Camera API is not supported in this browser environment');
      }

      let newStream: MediaStream | null = null;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1080 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
      } catch {
        // Fallback to general video constraint
        newStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      if (newStream) {
        streamRef.current = newStream;
        setStream(newStream);
      }
    } catch (err: any) {
      logger.warn('[Camera] Failed to initialize camera stream:', err);
      setCameraError(err.message || 'Camera permission denied or camera not available');
    } finally {
      setIsStarting(false);
    }
  }, [facingMode, stopStream]);

  // Bind srcObject when stream or videoRef becomes available
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    if (isOpen) {
      setCapturedPhoto(null);
      startCamera();
    } else {
      stopStream();
    }

    return () => {
      stopStream();
    };
  }, [isOpen, startCamera, stopStream]);

  const handleTakeSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;
    playPress(900);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const size = Math.min(video.videoWidth || 640, video.videoHeight || 640);

    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      const startX = ((video.videoWidth || size) - size) / 2;
      const startY = ((video.videoHeight || size) - size) / 2;

      // Draw centered square crop
      ctx.drawImage(video, startX, startY, size, size, 0, 0, size, size);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      setCapturedPhoto(dataUrl);
      playLike();
      stopStream();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setCapturedPhoto(dataUrl);
        stopStream();
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFlipCamera = () => {
    playPress(750);
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  const handleConfirmPhoto = () => {
    if (!capturedPhoto) return;
    playPress(800);
    onCapture(capturedPhoto);
    toast?.('Snapshot captured and attached!', 'success');
    onClose();
  };

  const handleRetake = () => {
    playPress(700);
    setCapturedPhoto(null);
    startCamera();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex items-center justify-center p-0 sm:p-4 animate-orbit-fade-in select-none"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised text-retro-fg w-full max-w-lg rounded-none sm:rounded-3xl border border-border-glass shadow-2xl overflow-hidden flex flex-col h-full sm:h-auto max-h-screen sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-surface-raised border-b border-border-glass flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-retro-fg" />
            <h3 className="text-sm font-black text-retro-fg tracking-tight">Camera Snapshot</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-retro-muted hover:text-retro-fg hover:bg-surface-interactive cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder Viewport */}
        <div className="relative aspect-square w-full bg-black flex items-center justify-center overflow-hidden">
          {cameraError ? (
            <div className="p-6 text-center space-y-3 bg-surface-canvas text-white w-full h-full flex flex-col items-center justify-center">
              <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
              <p className="text-xs text-retro-body font-medium leading-relaxed max-w-xs mx-auto">
                {cameraError}
              </p>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-4 py-2 bg-surface-raised text-retro-fg text-xs font-bold rounded-xl cursor-pointer hover:bg-white/15"
                >
                  Try Again
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-surface-elevated text-white text-xs font-bold rounded-xl cursor-pointer hover:bg-zinc-700 flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload File</span>
                </button>
              </div>
            </div>
          ) : capturedPhoto ? (
            <img src={capturedPhoto} alt="Snapshot preview" className="w-full h-full object-cover" />
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
              />
              {/* Instagram Grid Guide Overlay */}
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-25 border border-white/40">
                <div className="border-r border-b border-white" />
                <div className="border-r border-b border-white" />
                <div className="border-b border-white" />
                <div className="border-r border-b border-white" />
                <div className="border-r border-b border-white" />
                <div className="border-b border-white" />
                <div className="border-r border-white" />
                <div className="border-r border-white" />
                <div />
              </div>
            </>
          )}

          <canvas ref={canvasRef} className="hidden" />
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
        </div>

        {/* Action Controls Footer */}
        <div className="p-4 bg-surface-raised border-t border-border-glass flex items-center justify-around gap-4">
          {capturedPhoto ? (
            <>
              <button
                type="button"
                onClick={handleRetake}
                className="flex-1 py-3 bg-surface-interactive hover:bg-[#e4e4e7] text-retro-fg rounded-2xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors border border-border-glass"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retake</span>
              </button>
              <button
                type="button"
                onClick={handleConfirmPhoto}
                className="flex-1 py-3 bg-gradient-to-r from-cyan-500 via-teal-500 to-amber-500 hover:opacity-95 text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md"
              >
                <Check className="w-4 h-4" />
                <span>Attach to Post</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-3 bg-surface-interactive hover:bg-[#e4e4e7] text-retro-fg rounded-full cursor-pointer transition-colors border border-border-glass"
                title="Upload Photo File"
              >
                <Upload className="w-5 h-5" />
              </button>

              {/* Shutter Button */}
              <button
                type="button"
                onClick={handleTakeSnapshot}
                disabled={!!cameraError || isStarting}
                className="w-16 h-16 rounded-full bg-gradient-to-tr from-cyan-500 via-teal-500 to-amber-500 p-1 cursor-pointer hover:scale-105 active:scale-95 transition-transform shadow-xl disabled:opacity-30"
              >
                <div className="w-full h-full rounded-full border-2 border-white bg-surface-raised flex items-center justify-center" />
              </button>

              <button
                type="button"
                onClick={handleFlipCamera}
                disabled={!!cameraError || isStarting}
                className="p-3 bg-surface-interactive hover:bg-[#e4e4e7] text-retro-fg rounded-full cursor-pointer transition-colors border border-border-glass"
                title="Flip Camera"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
