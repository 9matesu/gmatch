"use client";

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'goonmatch-settings'
const SFX_MIGRATED_KEY = 'goonmatch-settings-sfx-on'
const OPACITY_MIGRATED_KEY = 'gmatch.opacity_migrated.v2'

export interface AppSettings {
  galleryCols: '2' | '3'
  feedCols: '1' | '2' | '3' | '4' | '5'
  hideDuplicates: boolean
  soundEffects: boolean
  watchPartyEnabled: boolean
  autoRefresh: boolean
  advancedMode: boolean
  maximumGooner: boolean
  maximumGooning: boolean
  allowRemoteWallpaper: boolean
  wallpaperUrl: string
  wallpaperPreset: string
  wallpaperFit: 'cover' | 'contain' | 'repeat'
  wallpaperSlideshow: boolean
  wallpaperSlideshowInterval: number
  wallpaperMime: string
  autoOpenImages: boolean
  autoForwardAll: boolean
  sidebarVisible: boolean
  headerVisible: boolean
  idleTimeout: number
  idleEnabled: boolean
  // Shell chrome transparency (0.35 – 1). Drives the --panel-alpha CSS var.
  panelOpacity: number
  // Glass blur multiplier (0 – 1). Drives --glass-blur on every backdrop site.
  glassBlur: number
  // Infinite chrome sheen animations (paused by default; CDP perf sweep).
  animatedChrome: boolean
  // PC Domination (opt-in remote effects)
  pcDominationEnabled: boolean
  allowDesktopBackgroundChange: boolean
  allowGameBackgroundChange: boolean
  allowPopupVideo: boolean
  allowPopupMessage: boolean
  allowTextOverlay: boolean
  allowBlurEverything: boolean
  allowRemoteCamera: boolean
  allowPublicCamera: boolean
  /** Opt-in: purchased hack items (lock, vision jam) can land on you. */
  allowHacks: boolean
  cameraPermissionMode: 'prompt' | 'auto' | 'deny'
  dominationIntensity: 'mild' | 'medium' | 'extreme'
  /** Panic pause: inbound effects are dropped until this timestamp (ms). */
  dominationInboundMutedUntil: number
  // Creative Enhancements
  streamerMode: boolean
  audioPack: 'chiptune' | 'arcade' | 'minimal' | 'silent'
  chatNotificationSfx: boolean
  duelPacing: 'instant' | 'fast' | 'dramatic'
  accentColor: 'pink' | 'cyan' | 'gold' | 'emerald' | 'violet'
  theme: 'dark' | 'instagram-white'
  /**
   * Opt-in local media vault: gallery keeps + card bytes stored on disk
   * (userData/media-vault, 3GB LRU). Off = memory-only, nothing hits disk.
   */
  localVault: boolean
}

const DEFAULTS: AppSettings = {
  galleryCols: '2',
  feedCols: '1',
  hideDuplicates: false,
  soundEffects: true,
  watchPartyEnabled: true,
  autoRefresh: true,
  advancedMode: false,
  maximumGooner: false,
  maximumGooning: false,
  allowRemoteWallpaper: true,
  wallpaperUrl: '',
  wallpaperPreset: 'default',
  wallpaperFit: 'cover',
  wallpaperSlideshow: false,
  wallpaperSlideshowInterval: 8000,
  wallpaperMime: '',
  autoOpenImages: false,
  autoForwardAll: false,
  sidebarVisible: false,
  headerVisible: false,
  idleTimeout: 5,
  idleEnabled: false,
  panelOpacity: 0.75,
  glassBlur: 0.7,
  animatedChrome: false,
  pcDominationEnabled: false,
  allowDesktopBackgroundChange: true,
  allowGameBackgroundChange: true,
  allowPopupVideo: true,
  allowPopupMessage: true,
  allowTextOverlay: true,
  allowBlurEverything: true,
  allowRemoteCamera: false,
  allowPublicCamera: false,
  allowHacks: false,
  cameraPermissionMode: 'prompt',
  dominationIntensity: 'medium',
  dominationInboundMutedUntil: 0,
  streamerMode: false,
  audioPack: 'arcade',
  chatNotificationSfx: true,
  duelPacing: 'fast',
  accentColor: 'pink',
  theme: 'dark',
  localVault: false,
}

function load(): AppSettings {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const stored = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
    // SFX is on by default: one-time migration so users who previously saved
    // sound off (or who have no stored value) get effects enabled.
    if (!localStorage.getItem(SFX_MIGRATED_KEY)) {
      stored.soundEffects = true
      stored.chatNotificationSfx = true
      localStorage.setItem(SFX_MIGRATED_KEY, '1')
      save(stored)
    }
    // Default panel opacity to 0.75 (frosted glass) out of the box. Users can
    // drag the opacity slider up to 1.0 (100%) for fully opaque solid panels.
    if (!localStorage.getItem(OPACITY_MIGRATED_KEY)) {
      stored.panelOpacity = 0.75
      localStorage.setItem(OPACITY_MIGRATED_KEY, '1')
      save(stored)
    }
    return stored
  } catch {}
  return DEFAULTS
}

function save(settings: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {}
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(load)

  useEffect(() => {
    save(settings)
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('theme-instagram-white')
      document.documentElement.setAttribute('data-theme', 'dark')
    }
  }, [settings])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleSync = (e: Event) => {
      const custom = e as CustomEvent<{ key: keyof AppSettings; value: any } | { all: AppSettings }>
      if (custom.detail) {
        if ('all' in custom.detail && custom.detail.all) {
          setSettings(custom.detail.all)
        } else if ('key' in custom.detail) {
          const { key, value } = custom.detail
          setSettings(prev => (prev[key] === value ? prev : { ...prev, [key]: value }))
        }
      }
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue)
          setSettings(prev => ({ ...prev, ...parsed }))
        } catch {}
      }
    }

    window.addEventListener('orbit-settings-updated', handleSync)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('orbit-settings-updated', handleSync)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => {
      if (prev[key] === value) return prev
      const next = { ...prev, [key]: value }
      save(next)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('orbit-settings-updated', { detail: { key, value } }))
      }
      return next
    })
  }, [])

  return { settings, update }
}
