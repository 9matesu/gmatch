// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AppSettings } from '../../hooks/useSettings'
import type { OrbitIdentity } from '@orbit/crypto'
import { GMatchSettingsModal } from './GMatchSettingsModal'

// Section bodies own their own bridge probes; this test pins the shell only.
vi.mock('./UpdateSection', () => ({ UpdateSection: () => null }))
vi.mock('./CommunitySection', () => ({ CommunitySection: () => null }))
vi.mock('./ImportPostsSection', () => ({ ImportPostsSection: () => null }))
vi.mock('./RecacheMediaSection', () => ({ RecacheMediaSection: () => null }))
vi.mock('./TurnSection', () => ({ TurnSection: () => null }))
vi.mock('./MediaqSection', () => ({ MediaqSection: () => null }))
vi.mock('./DiagnosticsSection', () => ({ DiagnosticsSection: () => null }))
vi.mock('./CacheViewer', () => ({ CacheViewer: () => null }))
vi.mock('./BlocklistSection', () => ({ BlocklistSection: () => <div>compact blocklist</div> }))
vi.mock('../PasskeyManager', () => ({ PasskeyManager: () => null }))
vi.mock('./DeleteAccountSection', () => ({ DeleteAccountSection: () => null }))
vi.mock('../../components/LegalCenter', () => ({ LegalCenter: () => null }))

const settings = {
  theme: 'dark',
  panelOpacity: 0.75,
  feedCols: '2',
  galleryCols: '2',
  soundEffects: true,
  chatNotificationSfx: true,
  cameraPermissionMode: 'prompt',
  meshEnabled: true,
  meshCommunityKey: 'gmatch-open-mesh-v1',
  meshObfuscateHave: false,
  wallpaperUrl: '',
  wallpaperFit: 'cover',
  wallpaperSlideshow: false,
  wallpaperSlideshowInterval: 8000,
  localVault: false,
} as unknown as AppSettings

const identity = { orbitId: 'alice' } as OrbitIdentity

function open(updateSettings = vi.fn(), ownerId: string | null = null) {
  if (ownerId !== null) {
    (window as unknown as { gmatch: unknown }).gmatch = { serverState: async () => ({ nodeOwnerId: ownerId }) }
  }
  return render(
    <GMatchSettingsModal
      isOpen
      onClose={vi.fn()}
      settings={settings}
      updateSettings={updateSettings}
      identity={identity}
    />,
  )
}

const nav = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

afterEach(() => {
  delete (window as unknown as { gmatch?: unknown }).gmatch
})

describe('GMatchSettingsModal sections', () => {
  it('shows the seven Discord-style sections, wallpaper on the default tab', () => {
    open()
    for (const name of ['General', 'Security', 'Audio', 'Camera', 'Network', 'Preferences', 'Blocklist']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /wallpaper settings/i })).toBeVisible()
  })

  it('keeps single-line settings text fields compact', () => {
    open()
    const excludes = screen.getByLabelText('Add an excluded tag')
    expect(excludes.className).toContain('py-1.5')
    expect(excludes.className).not.toMatch(/\bpy-(2|2\.5|3)\b/)

    fireEvent.click(screen.getByRole('button', { name: /Expand wallpaper settings/i }))
    const url = screen.getByPlaceholderText(/Direct image or video URL/)
    expect(url.className).toContain('py-1.5')
    expect(url.className).not.toMatch(/\bpy-(2|2\.5|3)\b/)
  })

  it('drops the dead display options from General', () => {
    open()
    nav('General')
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByLabelText('Panel opacity')).toBeInTheDocument()
    for (const label of [
      'Glass blur', 'Animated chrome', 'Watch Party tab',
      'Auto-Refresh Heartbeat Sync', 'Hide Duplicate Cards', 'Duel Reveal Pacing',
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('groups audio together and puts camera selection in Camera', () => {
    const updateSettings = vi.fn()
    open(updateSettings)
    nav('Audio')
    expect(screen.getByRole('switch', { name: 'Sound effects' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Chat Notification Sound' })).toBeInTheDocument()

    nav('Camera')
    const group = screen.getByRole('group', { name: 'Camera requests' })
    fireEvent.click(within(group).getByRole('button', { name: 'Deny' }))
    expect(updateSettings).toHaveBeenCalledWith('cameraPermissionMode', 'deny')
  })

  it('keeps mesh discovery owner-only and drops the old media toggles', () => {
    open()
    nav('Network')
    expect(screen.queryByRole('switch', { name: 'Mesh discovery' })).not.toBeInTheDocument()
    nav('Preferences')
    for (const label of ['Idle mode', 'Auto-open images', 'Hide notification content', 'Allow remote wallpaper']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }

    cleanup()
    open(vi.fn(), 'alice')
    nav('Network')
    return waitFor(() => expect(screen.getByRole('switch', { name: 'Mesh discovery' })).toBeInTheDocument())
  })

  it('hands the Blocklist tab to the compact section', () => {
    open()
    nav('Blocklist')
    expect(screen.getByText('compact blocklist')).toBeInTheDocument()
  })
})
