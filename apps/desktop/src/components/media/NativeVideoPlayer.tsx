"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  Maximize2,
  Repeat,
  Loader2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { resolveMediaUrl } from '../../utils/media';

export interface NativeVideoPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  /** Buffering hint: party players pass 'auto' to fetch past metadata before play. */
  preload?: 'none' | 'metadata' | 'auto';
  controls?: boolean;
  alwaysShowControls?: boolean;
  className?: string;
  videoClassName?: string;
  style?: React.CSSProperties;
  onExpand?: () => void;
  onDoubleTapLike?: () => void;
  compact?: boolean;
  playOnHover?: boolean;
  showFullscreenButton?: boolean;
  showPipButton?: boolean;
  showSpeedButton?: boolean;
  showLoopButton?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onError?: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
  onLoadedData?: () => void;
  disableViewportGating?: boolean;
}

export function formatVideoTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const sStr = s < 10 ? `0${s}` : `${s}`;
  if (h > 0) {
    const mStr = m < 10 ? `0${m}` : `${m}`;
    return `${h}:${mStr}:${sStr}`;
  }
  return `${m}:${sStr}`;
}

const SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2];

export function NativeVideoPlayer({
  src,
  poster,
  autoPlay = false,
  loop = true,
  muted = false,
  playsInline = true,
  preload = 'metadata',
  controls = true,
  alwaysShowControls = false,
  className = '',
  videoClassName = '',
  style,
  onExpand,
  onDoubleTapLike,
  compact = false,
  playOnHover = false,
  showFullscreenButton = true,
  showPipButton = true,
  showSpeedButton = true,
  showLoopButton = true,
  onPlay,
  onPause,
  onError,
  onLoadedData,
  disableViewportGating = false,
}: NativeVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrubBarRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTapTimeRef = useRef<number>(0);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferedPct, setBufferedPct] = useState<number>(0);
  const [volume, setVolume] = useState<number>(muted ? 0 : 1);
  const [isMuted, setIsMuted] = useState<boolean>(muted);
  const [prevVolume, setPrevVolume] = useState<number>(1);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isLooping, setIsLooping] = useState<boolean>(loop);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [actionPulse, setActionPulse] = useState<'play' | 'pause' | null>(null);
  const [inView, setInView] = useState<boolean>(() => typeof IntersectionObserver === 'undefined');

  // Scrubber hover state
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);

  const resolvedSrc = resolveMediaUrl(src);
  // Poster needs the same resolution as src: callers hand over bare object
  // ids (/api/objects/<id> backed), and an unresolved uuid makes the browser
  // request it relative to the page — net::ERR_FILE_NOT_FOUND in the console.
  const resolvedPoster = resolveMediaUrl(poster) || undefined;

  useEffect(() => {
    setHasError(false);
    setCurrentTime(0);
    setIsBuffering(false);
  }, [resolvedSrc]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentFs = document.fullscreenElement === containerRef.current;
      setIsFullscreen(isCurrentFs);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Viewport gating: keep preload='none' and pause when scrolled out of
  // viewport so off-screen players allocate ZERO GPU hardware video decoders.
  useEffect(() => {
    if (disableViewportGating) {
      setInView(true);
      return;
    }
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const v = videoRef.current;
          if (entry.isIntersecting) {
            setInView(true);
            if (autoPlay && v && v.paused) {
              v.play().catch(() => {});
            }
          } else {
            if (v && !v.paused) {
              v.pause();
            }
          }
        });
      },
      { rootMargin: '300px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [autoPlay, disableViewportGating]);

  const resetHideControlsTimer = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);

    if (!alwaysShowControls && isPlaying && !isScrubbing) {
      hideControlsTimerRef.current = setTimeout(() => {
        setShowControls(false);
      }, 2500);
    }
  }, [alwaysShowControls, isPlaying, isScrubbing]);

  useEffect(() => {
    resetHideControlsTimer();
    return () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    };
  }, [isPlaying, isScrubbing, resetHideControlsTimer]);

  useEffect(() => {
    if (autoPlay && videoRef.current) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [autoPlay, resolvedSrc]);

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) {
      v.play()
        .then(() => {
          setIsPlaying(true);
          setActionPulse('play');
          setTimeout(() => setActionPulse(null), 500);
          onPlay?.();
        })
        .catch(() => {});
    } else {
      v.pause();
      setIsPlaying(false);
      setActionPulse('pause');
      setTimeout(() => setActionPulse(null), 500);
      onPause?.();
    }
  }, [onPlay, onPause]);

  const toggleMute = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;

    if (isMuted || volume === 0) {
      const targetVol = prevVolume > 0 ? prevVolume : 0.7;
      v.muted = false;
      v.volume = targetVol;
      setIsMuted(false);
      setVolume(targetVol);
    } else {
      setPrevVolume(volume);
      v.muted = true;
      v.volume = 0;
      setIsMuted(true);
      setVolume(0);
    }
  }, [isMuted, volume, prevVolume]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    const v = videoRef.current;
    if (v) {
      v.volume = newVol;
      if (newVol > 0 && isMuted) {
        v.muted = false;
        setIsMuted(false);
      } else if (newVol === 0 && !isMuted) {
        v.muted = true;
        setIsMuted(true);
      }
    }
  }, [isMuted]);

  const cycleSpeed = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const currentIndex = SPEED_OPTIONS.indexOf(playbackRate);
    const nextRate = SPEED_OPTIONS[(currentIndex + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(nextRate);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate;
    }
  }, [playbackRate]);

  const toggleLoop = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const next = !isLooping;
    setIsLooping(next);
    if (videoRef.current) {
      videoRef.current.loop = next;
    }
  }, [isLooping]);

  const toggleFullscreen = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const el = containerRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      try {
        await el.requestFullscreen();
      } catch {}
    } else {
      try {
        await document.exitFullscreen();
      } catch {}
    }
  }, []);

  const togglePip = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await v.requestPictureInPicture();
      }
    } catch {}
  }, []);

  const handleScrubPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const el = scrubBarRef.current;
    const v = videoRef.current;
    if (!el || !v || !duration) return;

    el.setPointerCapture(e.pointerId);
    setIsScrubbing(true);

    const rect = el.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = pos * duration;
    v.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleScrubPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrubBarRef.current;
    if (!el || !duration) return;

    const rect = el.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(pos * 100);
    setHoverTime(pos * duration);

    if (isScrubbing && videoRef.current) {
      const newTime = pos * duration;
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleScrubPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIsScrubbing(false);
    try {
      scrubBarRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleVideoCanvasClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const now = Date.now();
    const diff = now - lastTapTimeRef.current;
    lastTapTimeRef.current = now;

    if (diff < 300) {
      if (onDoubleTapLike) {
        togglePlay();
        onDoubleTapLike();
      } else {
        togglePlay();
        void toggleFullscreen();
      }
    } else {
      togglePlay();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const v = videoRef.current;
    if (!v) return;

    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
      case 'j':
        e.preventDefault();
        v.currentTime = Math.max(0, v.currentTime - 5);
        break;
      case 'ArrowRight':
      case 'l':
        e.preventDefault();
        v.currentTime = Math.min(duration, v.currentTime + 5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setVolume((prev) => {
          const next = Math.min(1, prev + 0.1);
          v.volume = next;
          return next;
        });
        break;
      case 'ArrowDown':
        e.preventDefault();
        setVolume((prev) => {
          const next = Math.max(0, prev - 0.1);
          v.volume = next;
          return next;
        });
        break;
      case 'm':
        e.preventDefault();
        toggleMute();
        break;
      case 'f':
        e.preventDefault();
        void toggleFullscreen();
        break;
    }
  };

  const handleMouseEnter = () => {
    resetHideControlsTimer();
    if (playOnHover && videoRef.current) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const handleMouseLeave = () => {
    if (playOnHover && videoRef.current) {
      videoRef.current.pause();
      try {
        videoRef.current.currentTime = 0;
      } catch {}
      setIsPlaying(false);
    }
    if (isPlaying && !alwaysShowControls) {
      setShowControls(false);
    }
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={resetHideControlsTimer}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-media-url={resolvedSrc}
      className={`relative select-none outline-none group bg-black overflow-hidden flex items-center justify-center ${
        isFullscreen ? 'w-screen h-screen' : 'w-full h-full'
      } ${className}`}
      style={style}
    >
      <video
        ref={videoRef}
        src={resolvedSrc}
        poster={resolvedPoster}
        autoPlay={inView ? autoPlay : false}
        loop={isLooping}
        muted={isMuted}
        playsInline={playsInline}
        preload={inView ? preload : 'none'}
        className={`w-full h-full object-contain pointer-events-auto cursor-pointer ${videoClassName}`}
        onClick={handleVideoCanvasClick}
        onTimeUpdate={() => {
          if (!isScrubbing && videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
          }
        }}
        onDurationChange={() => {
          if (videoRef.current) setDuration(videoRef.current.duration || 0);
        }}
        onProgress={() => {
          const v = videoRef.current;
          if (v && v.buffered.length > 0 && v.duration > 0) {
            const end = v.buffered.end(v.buffered.length - 1);
            setBufferedPct((end / v.duration) * 100);
          }
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onLoadedData={() => onLoadedData?.()}
        onError={(e) => {
          setHasError(true);
          setIsBuffering(false);
          onError?.(e);
        }}
      />

      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="p-3.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white shadow-xl animate-spin">
            <Loader2 className="w-8 h-8 text-retro-accent" />
          </div>
        </div>
      )}

      {actionPulse && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 animate-orbit-pop">
          <div className="p-4 rounded-full bg-black/70 backdrop-blur-md text-white border border-white/20 shadow-2xl">
            {actionPulse === 'play' ? (
              <Play className="w-10 h-10 fill-white text-white translate-x-0.5" />
            ) : (
              <Pause className="w-10 h-10 fill-white text-white" />
            )}
          </div>
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 bg-retro-panel/95 flex flex-col items-center justify-center gap-3 p-4 text-center z-30">
          <AlertCircle className="w-10 h-10 text-retro-error" />
          <p className="text-xs font-semibold text-retro-fg">Unable to load video source</p>
          <button
            type="button"
            onClick={() => {
              setHasError(false);
              if (videoRef.current) {
                videoRef.current.load();
                videoRef.current.play().catch(() => {});
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-interactive hover:bg-glass-w12 border border-border-glass text-xs font-medium text-retro-fg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {controls && !isPlaying && !isBuffering && !hasError && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 transition-opacity duration-300"
          onClick={togglePlay}
        >
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Play video"
            className="pointer-events-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/60 hover:bg-black/85 backdrop-blur-md border border-white/20 text-white flex items-center justify-center shadow-2xl transition-all duration-150 hover:scale-110 active:scale-95 group/btn cursor-pointer"
          >
            <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-white text-white translate-x-0.5 group-hover/btn:text-retro-accent group-hover/btn:fill-retro-accent transition-colors" />
          </button>
        </div>
      )}

      {controls && (
        <div
          className={`absolute top-0 inset-x-0 p-3 flex items-center justify-between z-20 pointer-events-none transition-opacity duration-300 bg-gradient-to-b from-black/80 via-black/30 to-transparent ${
            alwaysShowControls || showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-1.5 pointer-events-auto">
            <span className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-xs border border-white/10 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
              HD Video
            </span>
            {playbackRate !== 1 && (
              <span className="px-1.5 py-0.5 rounded-md bg-retro-accent/20 border border-retro-accent/40 text-[10px] font-bold text-retro-accent">
                {playbackRate}x
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 pointer-events-auto">
            {onExpand && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpand();
                }}
                title="Expand to Fullscreen / Lightbox"
                className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 backdrop-blur-xs border border-white/10 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {controls && !compact && (
        <div
          className={`absolute bottom-0 inset-x-0 z-20 flex flex-col justify-end pt-8 pb-2 px-3 bg-gradient-to-t from-black/95 via-black/60 to-transparent transition-opacity duration-300 ${
            alwaysShowControls || showControls || isScrubbing || !isPlaying ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={scrubBarRef}
            onPointerDown={handleScrubPointerDown}
            onPointerMove={handleScrubPointerMove}
            onPointerUp={handleScrubPointerUp}
            onMouseEnter={() => setIsScrubbing(false)}
            onMouseLeave={() => setHoverTime(null)}
            className="relative w-full h-4 flex items-center cursor-pointer group/scrub"
          >
            <div className="w-full h-1 group-hover/scrub:h-2 rounded-full bg-glass-w20 overflow-hidden transition-all duration-150">
              <div
                className="h-full bg-glass-w20 rounded-full transition-all duration-150"
                style={{ width: `${bufferedPct}%` }}
              />
            </div>

            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 h-1 group-hover/scrub:h-2 rounded-full bg-gradient-to-r from-retro-accent to-white pointer-events-none transition-all duration-150"
              style={{ width: `${progressPct}%` }}
            />

            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-lg border border-black/20 pointer-events-none transition-transform duration-150 scale-0 group-hover/scrub:scale-100"
              style={{ left: `${progressPct}%` }}
            />

            {hoverTime !== null && (
              <div
                className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded bg-black/90 border border-white/20 text-[10px] font-mono font-bold text-white shadow-lg pointer-events-none"
                style={{ left: `${hoverPosition}%` }}
              >
                {formatVideoTime(hoverTime)}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 mt-1 text-white">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="p-1.5 rounded-md hover:bg-glass-w10 text-white transition-colors cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-white" />
                ) : (
                  <Play className="w-4 h-4 fill-white translate-x-0.5" />
                )}
              </button>

              <div className="flex items-center gap-1.5 group/vol">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="p-1.5 rounded-md hover:bg-glass-w10 text-white transition-colors cursor-pointer"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-zinc-400" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>

                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-14 sm:w-18 h-1 bg-glass-w20 rounded-full appearance-none cursor-pointer accent-retro-accent opacity-70 hover:opacity-100 transition-opacity"
                />
              </div>

              <div className="text-[10px] font-mono text-zinc-300 ml-1 select-none">
                <span>{formatVideoTime(currentTime)}</span>
                <span className="opacity-40 mx-1">/</span>
                <span className="opacity-75">{formatVideoTime(duration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {showSpeedButton && (
                <button
                  type="button"
                  onClick={cycleSpeed}
                  title="Playback Speed"
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold hover:bg-glass-w10 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  {playbackRate}x
                </button>
              )}

              {showLoopButton && (
                <button
                  type="button"
                  onClick={toggleLoop}
                  title={isLooping ? 'Loop is On' : 'Loop is Off'}
                  className={`p-1.5 rounded-md hover:bg-glass-w10 transition-colors cursor-pointer ${
                    isLooping ? 'text-retro-accent' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                </button>
              )}

              {showPipButton && typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (
                <button
                  type="button"
                  onClick={togglePip}
                  title="Picture in Picture"
                  className="p-1.5 rounded-md hover:bg-glass-w10 text-zinc-400 hover:text-white transition-colors cursor-pointer hidden sm:block"
                >
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                    <path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.99h18v14.02z" />
                  </svg>
                </button>
              )}

              {onExpand && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpand();
                  }}
                  title="Expand to Lightbox"
                  aria-label="Expand to Lightbox"
                  className="p-1.5 rounded-md hover:bg-glass-w10 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              )}

              {showFullscreenButton && (
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                  className="p-1.5 rounded-md hover:bg-glass-w10 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  {isFullscreen ? (
                    <Minimize className="w-4 h-4" />
                  ) : (
                    <Maximize className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
