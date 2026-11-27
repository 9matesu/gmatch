// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  defaultDiagnosticsLog,
  DiagnosticsSection,
  type DiagnosticsDeps,
  type DiagnosticsSummary,
} from './DiagnosticsSection'
import { metricsSnapshot } from '../../utils/metrics'

const BASE = 'http://127.0.0.1:8790'

function makeDeps(over: Partial<DiagnosticsDeps> = {}): DiagnosticsDeps {
  return {
    getApiBase: vi.fn(() => BASE),
    readServer: vi.fn(async () => ({ packaged: true, mode: 'client' as const, url: 'http://10.0.0.2:8790' })),
    probe: vi.fn(async () => ({ ok: true, status: 200 })),
    reconnect: vi.fn(async () => ({ mode: 'client' as const, url: 'http://10.0.0.2:8790', status: 200 })),
    repullRoster: vi.fn(async () => ({ peers: 3, via: 'online roster' })),
    clearCache: vi.fn(async () => ({ files: 12, bytes: 1048576 })),
    restartSidecar: vi.fn(async () => ({ ok: true })),
    health: vi.fn(async () => ({ ok: true, status: 200, body: { status: 'ok', db_ready: true } })),
    countPeers: vi.fn(async () => 3),
    metrics: vi.fn(() => metricsSnapshot()),
    logDev: vi.fn(),
    ...over,
  }
}

async function renderPanel(deps: DiagnosticsDeps) {
  await act(async () => { render(<DiagnosticsSection deps={deps} />) })
}

const summary: DiagnosticsSummary = {
  at: 1_700_000_000_000,
  base: BASE,
  server: { packaged: true, mode: 'host', url: '' },
  health: { ok: true, status: 200, body: { status: 'ok', db_ready: true } },
  peers: 4,
  metrics: metricsSnapshot(),
}

describe('DiagnosticsSection', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('calls the real fix mechanisms and reports each real outcome', async () => {
    const d = makeDeps()
    await renderPanel(d)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reconnect' })) })
    expect(d.reconnect).toHaveBeenCalledWith(BASE)
    expect(await screen.findByText(/node pointer set: client → http:\/\/10\.0\.0\.2:8790 \(HTTP 200\)/i)).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Re-pull roster' })) })
    expect(d.repullRoster).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/roster re-pulled: 3 peers via online roster/i)).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear cache' })) })
    expect(d.clearCache).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/cache cleared: 12 pictures, 1\.0 mb freed/i)).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restart sidecar' })) })
    expect(d.restartSidecar).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/local api restarted and answered \/api\/health/i)).toBeTruthy()
  })

  it('diagnoses from health + metrics + peers and logs a DEV console group', async () => {
    const d = makeDeps()
    await renderPanel(d)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Diagnose' })) })

    expect(d.health).toHaveBeenCalledWith(BASE)
    expect(d.countPeers).toHaveBeenCalledTimes(1)
    expect(d.metrics).toHaveBeenCalledTimes(1)
    expect(d.logDev).toHaveBeenCalledTimes(1)
    const logged = vi.mocked(d.logDev).mock.calls[0][0]
    expect(logged.health).toEqual({ ok: true, status: 200, body: { status: 'ok', db_ready: true } })
    expect(logged.peers).toBe(3)
    expect(logged.metrics).toBeTruthy()
    expect(await screen.findByText(/HTTP 200/)).toBeTruthy()
    expect(screen.getByText(/"db_ready": true/)).toBeTruthy()
  })

  it('reports a failed fix inline instead of claiming success', async () => {
    const d = makeDeps({
      reconnect: vi.fn(async () => { throw new Error('health probe failed: timeout') }),
      health: vi.fn(async () => ({ ok: false, status: null, body: null, error: 'fetch failed' })),
      countPeers: vi.fn(async () => null),
    })
    await renderPanel(d)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reconnect' })) })
    expect(await screen.findByText('health probe failed: timeout')).toBeTruthy()
    expect(screen.queryByText(/node pointer set/i)).toBeNull()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Diagnose' })) })
    expect(await screen.findByText(/fetch failed · unknown peers/)).toBeTruthy()
  })

  it('groups a structured summary in the console when DEV logging is enabled', () => {
    const group = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    const end = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    defaultDiagnosticsLog(summary, true)

    expect(group).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('health', summary.health)
    expect(log).toHaveBeenCalledWith('peers', 4)
    expect(log).toHaveBeenCalledWith('metrics', summary.metrics)
    expect(end).toHaveBeenCalledTimes(1)

    // The production path is silent: diagnostics never spam a shipped console.
    log.mockClear()
    defaultDiagnosticsLog(summary, false)
    expect(log).not.toHaveBeenCalled()
  })

  it('renders all five real actions', async () => {
    await renderPanel(makeDeps())
    for (const name of ['Diagnose', 'Reconnect', 'Re-pull roster', 'Clear cache', 'Restart sidecar']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })
})
