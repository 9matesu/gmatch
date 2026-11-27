"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { playPress } from '../../utils/sounds';
import { Camera, X, RefreshCw, Check, AlertCircle, Upload } from 'lucide-react';
import { logger } from '../../utils/logger';
import { Button } from '../../ui/kit';
import { classes, CHROME, COLOR, GAP, ICON, MOTION, PADDING, RADIUS, RECIPE, SHADOW, STATUS, TRACKING, TYPE, WEIGHT } from '../../ui/tokens';

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
      playPress(820);
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
      className={classes(RECIPE.modalOverlay, 'p-0 sm:p-4 select-none')}
      onClick={onClose}
    >
      <div
        className={classes(CHROME.overlayPanel, COLOR.fg, 'w-full max-w-lg overflow-hidden flex flex-col h-full sm:h-auto max-h-dvh sm:max-h-(--max-h-dialog)')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={classes(PADDING[4], COLOR.surfaceRaised, 'border-b', COLOR.edge, 'flex items-center justify-between')}>
          <div className={classes('flex items-center', GAP[2])}>
            <Camera className={classes(ICON.lg, COLOR.fg)} />
            <h3 className={classes(TYPE.body, WEIGHT.heading, COLOR.fg, TRACKING.tight)}>Camera snapshot</h3>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close camera"
            className={classes(RADIUS.pill, PADDING[1])}
          >
            <X className={ICON.md} />
          </Button>
        </div>

        {/* Viewfinder Viewport */}
        <div className="relative aspect-square w-full bg-retro-bg flex items-center justify-center overflow-hidden">
          {cameraError ? (
            <div className={classes(PADDING[6], 'text-center space-y-3', COLOR.canvasSurface, COLOR.fg, 'w-full h-full flex flex-col items-center justify-center')}>
              <AlertCircle className={classes('w-12 h-12', STATUS.danger, 'mx-auto')} />
              <p className={classes(TYPE.body, COLOR.body, WEIGHT.medium, 'leading-relaxed max-w-xs mx-auto')}>
                {cameraError}
              </p>
              <div className={classes('flex', GAP[2], 'pt-2')}>
                <Button type="button" variant="secondary" onClick={startCamera}>Try Again</Button>
                <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} className={classes('flex items-center', GAP[1.5])}>
                  <Upload className={ICON.sm} />
                  <span>Upload File</span>
                </Button>
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
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-25 border border-edge-strong">
                <div className="border-r border-b border-edge" />
                <div className="border-r border-b border-edge" />
                <div className="border-b border-edge" />
                <div className="border-r border-b border-edge" />
                <div className="border-r border-b border-edge" />
                <div className="border-b border-edge" />
                <div className="border-r border-edge" />
                <div className="border-r border-edge" />
                <div />
              </div>
            </>
          )}

          <canvas ref={canvasRef} className="hidden" />
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
        </div>

        {/* Action Controls Footer */}
        <div className={classes(PADDING[4], COLOR.surfaceRaised, 'border-t', COLOR.edge, 'flex items-center justify-around', GAP[4])}>
          {capturedPhoto ? (
            <>
              <Button type="button" variant="secondary" onClick={handleRetake} className={classes('flex-1', 'flex items-center justify-center', GAP[2], 'py-3')}>
                <RefreshCw className={ICON.md} />
                <span>Retake</span>
              </Button>
              <Button type="button" variant="primary" onClick={handleConfirmPhoto} className={classes('flex-1', 'flex items-center justify-center', GAP[2], 'py-3', WEIGHT.heading)}>
                <Check className={ICON.md} />
                <span>Attach to Post</span>
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                className={classes(RADIUS.pill, COLOR.hoverAccent, PADDING[3])}
                title="Upload Photo File"
              >
                <Upload className={ICON.lg} />
              </Button>

              {/* Shutter Button — camera chrome, not a shell button. */}
              <button
                type="button"
                onClick={handleTakeSnapshot}
                disabled={!!cameraError || isStarting}
                aria-label="Take photo"
                className={classes('w-16 h-16', RADIUS.pill, COLOR.accentBg, PADDING[1], 'cursor-pointer hover:scale-105 active:scale-95', MOTION.transition.transform, SHADOW.modal, 'disabled:opacity-30')}
              >
                <div className={classes('w-full h-full', RADIUS.pill, 'border-2', COLOR.edge, COLOR.surfaceRaised, 'flex items-center justify-center')} />
              </button>

              <Button
                type="button"
                variant="secondary"
                onClick={handleFlipCamera}
                disabled={!!cameraError || isStarting}
                className={classes(RADIUS.pill, COLOR.hoverAccent, PADDING[3])}
                title="Flip Camera"
              >
                <RefreshCw className={ICON.lg} />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

