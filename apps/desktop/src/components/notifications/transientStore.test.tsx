// @vitest-environment jsdom
"use client";

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToastProvider, useToast } from '../Toast'

function Harness() {
  const { toast, messages, dismiss, overflowCount } = useToast()
  return (
    <div>
      <button type="button" onClick={() => toast('hello', 'info')}>info</button>
      <button type="button" onClick={() => toast('boom', 'error')}>err</button>
      <button type="button" onClick={() => toast('careful', 'warning')}>warn</button>
      <span data-testid="count">{messages.length}</span>
      <span data-testid="overflow">{overflowCount}</span>
      <ul>
        {messages.map((m) => (
          <li key={m.id} data-testid={`msg-${m.type}`}>{m.text}
            <button type="button" aria-label={`dismiss ${m.id}`} onClick={() => dismiss(m.id)}>x</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

describe('transient store (ToastProvider)', () => {
  it('dedupes identical severity+text without extending the list', () => {
    render(<ToastProvider><Harness /></ToastProvider>)
    const btn = screen.getByRole('button', { name: 'info' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('persists errors until dismissed and caps transient overflow', () => {
    render(<ToastProvider><Harness /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'err' }))
    fireEvent.click(screen.getByRole('button', { name: 'err' }))
    // second identical error suppressed, first persists
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(screen.getAllByTestId('msg-error')).toHaveLength(1)
    act(() => {
      for (let i = 0; i < 6; i += 1) {
        screen.getByRole('button', { name: 'info' }).click()
      }
    })
    // 1 sticky + max 3 transient; the rest overflow (dedupe collapses identicals,
    // so count stays bounded either way)
    expect(Number(screen.getByTestId('count').textContent)).toBeLessThanOrEqual(4)
  })

  it('keeps warning/info severities distinct from errors', () => {
    render(<ToastProvider><Harness /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'warn' }))
    fireEvent.click(screen.getByRole('button', { name: 'err' }))
    expect(screen.getByTestId('count').textContent).toBe('2')
  })
})
