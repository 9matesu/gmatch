// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { orbitFetch } = vi.hoisted(() => ({ orbitFetch: vi.fn() }))

vi.mock('../utils/api', () => ({
  orbitFetch,
  getApiBaseUrl: () => 'http://test.local',
}))
vi.mock('../components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('../components/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../hooks/useAdminWebSocket', () => ({ useAdminWebSocket: vi.fn() }))
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('../components/CardZoomModal', () => ({ CardZoomModal: () => null }))

import AdminApp from './AdminApp'

const mainIdentity = {
  orbitId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  publicKeyHex: 'aa', privateKeyHex: 'bb',
  encryptionPubHex: 'cc', encryptionPrivHex: 'dd',
}

describe('AdminApp identity binding', () => {
  beforeEach(() => {
    sessionStorage.clear()
    orbitFetch.mockReset()
    orbitFetch.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  })

  it('signs verify-pin with the app main identity passed via prop', async () => {
    render(<AdminApp identity={mainIdentity} />)
    fireEvent.change(screen.getByPlaceholderText('Secret Passcode'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: /unlock admin console/i }))
    await waitFor(() => expect(orbitFetch).toHaveBeenCalled())
    const call = orbitFetch.mock.calls.find(([e]) => String(e).includes('/api/admin/verify-pin'))
    expect(call).toBeDefined()
    expect(call![2]).toMatchObject({ orbitId: mainIdentity.orbitId })
  })
})
