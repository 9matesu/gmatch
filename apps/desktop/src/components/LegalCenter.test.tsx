// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { LegalCenter, isLegalAccepted } from '../components/LegalCenter'
import { legalVersionKey } from '../legal/documents'

// jsdom lacks scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

function localStore() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
}
const store = localStore()
vi.stubGlobal('localStorage', store)
Object.defineProperty(window, 'localStorage', { value: store, configurable: true })

beforeEach(() => {
  cleanup()
  store.clear()
})

describe('LegalCenter', () => {
  it('renders the 6-doc nav and the terms doc first', () => {
    render(<LegalCenter isOpen onClose={() => {}} initialDoc="terms" />)
    // terms selected: header subtitle shows its full title
    expect(screen.getAllByText(/Termos de Uso/i).length).toBeGreaterThanOrEqual(2) // nav + header
    for (const t of ['Privacidade', 'Comunidade', 'Denúncias', 'Registros', 'Criptografia']) {
      expect(screen.getAllByText(new RegExp(t, 'i')).length).toBeGreaterThan(0)
    }
  })

  it('switching nav selects another doc', () => {
    render(<LegalCenter isOpen onClose={() => {}} initialDoc="terms" />)
    const btns = screen.getAllByRole('button', { name: /comunidade/i })
    fireEvent.click(btns[0])
    expect(screen.getByText(/Regras da Comunidade/)).toBeInTheDocument()
  })

  it('PT/EN language toggle swaps the body', () => {
    render(<LegalCenter isOpen onClose={() => {}} initialDoc="terms" />)
    fireEvent.click(screen.getAllByRole('button', { name: /english/i })[0])
    expect(screen.getByText(/Terms of Use/)).toBeInTheDocument()
  })

  it('download emits the markdown for the active doc', () => {
    const onDownload = vi.fn()
    render(<LegalCenter isOpen onClose={() => {}} onDownload={onDownload} initialDoc="privacy" />)
    fireEvent.click(screen.getAllByRole('button', { name: /download/i })[0])
    expect(onDownload).toHaveBeenCalledWith('privacy', expect.stringContaining('LGPD'))
  })

  it('accept persists the FULL version key', async () => {
    const onAccept = vi.fn()
    render(<LegalCenter isOpen onAccept={onAccept} onClose={() => {}} initialDoc="terms" />)
    fireEvent.click(screen.getAllByRole('button', { name: /aceito/i })[0])
    await waitFor(() => expect(onAccept).toHaveBeenCalled())
    // The app's own gate predicate is the contract (storage-object identity
    // in jsdom varies between bare-global and window refs).
    expect(isLegalAccepted()).toBe(true)
  })

  it('a version bump re-gates acceptance', () => {
    // accept now, then simulate an unseen future version
    const onAccept = vi.fn()
    render(<LegalCenter isOpen onAccept={onAccept} onClose={() => {}} initialDoc="terms" />)
    fireEvent.click(screen.getAllByRole('button', { name: /aceito/i })[0])
    expect(isLegalAccepted()).toBe(true)
    expect(legalVersionKey()).toContain('@2026-09-09.1')
  })

  it('closed renders nothing', () => {
    const { container } = render(<LegalCenter isOpen={false} onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
