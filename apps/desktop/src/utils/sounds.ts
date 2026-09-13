"use client";

let ctx: AudioContext | null = null;
let gestureHooked = false;

function ensureGestureHook() {
  if (gestureHooked || typeof window === 'undefined') return;
  gestureHooked = true;
  const resume = () => {
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };
  window.addEventListener('pointerdown', resume, { passive: true });
  window.addEventListener('keydown', resume, { passive: true });
  window.addEventListener('touchstart', resume, { passive: true });
}

const lastPlayed = new Map<string, number>();

/**
 * Collapse rapid re-fires of the same game-event sound. The same match event
 * can reach several mounted panels at once (round panel + your-match tab +
 * notification hook), which used to stack identical one-shots.
 */
export function throttled<T extends (...a: never[]) => unknown>(
  fn: T,
  ms = 400,
  key?: string,
): T {
  const id = key ?? fn.name ?? "anon";
  return ((...a: Parameters<T>) => {
    const now = Date.now();
    const prev = lastPlayed.get(id);
    if (prev !== undefined && now - prev < ms) return undefined;
    lastPlayed.set(id, now);
    return (fn as unknown as (...x: Parameters<T>) => unknown)(...a);
  }) as unknown as T;
}

export const MUTE_KEY = '***';

export function isAudioMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === 'true'; } catch { return false; }
}

export function setAudioMuted(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, String(muted)); } catch { /* private mode */ }
}

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (isAudioMuted()) return null;
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
  }
  ensureGestureHook();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

/**
 * Atonal click: very short noise-based rimshot click with NO tonal oscillator,
 * at a subtle, comfortable lower volume.
 */
export function playAtonalClick(gainVol = 0.12, duration = 0.025) {
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;

  try {
    const len = Math.max(64, Math.floor(audio.sampleRate * duration));
    const buffer = audio.createBuffer(1, len, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // Rapid decaying noise transient (atonal snap)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const noise = audio.createBufferSource();
    noise.buffer = buffer;

    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    if (filter.frequency && typeof filter.frequency === 'object' && 'setValueAtTime' in filter.frequency) {
      filter.frequency.setValueAtTime(3200, now);
    } else if (filter.frequency && typeof filter.frequency === 'object' && 'value' in filter.frequency) {
      (filter.frequency as any).value = 3200;
    }
    if (filter.Q && typeof filter.Q === 'object' && 'value' in filter.Q) {
      (filter.Q as any).value = 1.2;
    }

    const gain = audio.createGain();
    gain.gain.setValueAtTime(gainVol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter).connect(gain).connect(audio.destination);
    noise.start(now);
    noise.stop(now + duration + 0.01);
  } catch {
    /* fallback safe */
  }
}

/** Short atonal punchy click (no tonal oscillator, lower volume) */
export function playPress(_freq?: number) {
  playAtonalClick(0.12, 0.022);
}

export function playBeep() {
  playPress();
}

/** Short rimshot click (atonal noise crack, lower volume, no tonal oscillator) */
export function playRimshot() {
  playAtonalClick(0.15, 0.032);
}

/** Idle clicker hit sound: atonal rimshot click when attacking image or cells */
export function playHit(crit: boolean = false) {
  playAtonalClick(crit ? 0.18 : 0.12, crit ? 0.032 : 0.02);
}

export function playChatMessage() {
  playRimshot();
}

export function playMsgReceive() {
  playRimshot();
}

/** Bright 3-tone notification chime */
export function playChime() {
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;
  const notes = [659.25, 830.61, 1046.50]; // E5, G#5, C6

  notes.forEach((freq, idx) => {
    const start = now + idx * 0.07;
    const osc = audio.createOscillator();
    const gain = audio.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.4, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);

    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.26);
  });
}

export const playNotification = playChime;

/** Uplifting like ding */
export function playLike() {
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;
  [523.25, 783.99].forEach((freq, idx) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const start = now + idx * 0.05;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.35, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);

    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.22);
  });
}

/** Low descending buzz for reject */
export function playReject() {
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(260, now);
  osc.frequency.exponentialRampToValueAtTime(110, now + 0.16);

  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

/** Triumphant Match Victory Chime */
export function playMatch() {
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;
  const chords = [523.25, 659.25, 783.99, 1046.50, 1318.51]; // C5, E5, G5, C6, E6

  chords.forEach((freq, idx) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const start = now + idx * 0.06;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.4, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.38);
  });
}

export const playWin = playMatch;
export const playMatchFound = playMatch;

/** Rising cascade for Tier Advance */
export function playTierUp() {
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;
  const notes = [440, 554.37, 659.25, 880, 1108.73, 1318.51];

  notes.forEach((freq, idx) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const start = now + idx * 0.05;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.35, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);

    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.32);
  });
}

/** Round start gong */
export function playRoundStart() {
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;

  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);

  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.22);
}

/** Clock tick */
export function playCountdown() {
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, now);

  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.04);
}

/** Heavy warning thud */
export function playTimeout() {
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);

  gain.gain.setValueAtTime(0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.27);
}

/** Ascending sweep */
export function playUpload() {
  const audio = ensureCtx();
  if (!audio) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(900, now + 0.18);

  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.22);
}

export function playQueueJoin() {
  playPress(1000);
}

export function resetChatSfx() {}

/* Game-event wrappers: one fire per window even when several panels mount the
 * same state transition (round panel + your-match tab + notifications hook). */
export const playMatchOnce = /* @__PURE__ */ throttled(playMatch, 1500, 'match');
export const playTierUpOnce = /* @__PURE__ */ throttled(playTierUp, 1500, 'tier');
export const playCountdownOnce = /* @__PURE__ */ throttled(playCountdown, 900, 'countdown');
export const playTimeoutOnce = /* @__PURE__ */ throttled(playTimeout, 1500, 'timeout');
export const playLikeOnce = /* @__PURE__ */ throttled(playLike, 300, 'like');
export const playRejectOnce = /* @__PURE__ */ throttled(playReject, 300, 'reject');
