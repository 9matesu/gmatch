// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { Switch } from './Switch'

describe('Switch', () => {
  it('reports its checked state through role="switch"', () => {
    const { getByRole, rerender } = render(<Switch checked={false} onChange={() => {}} label="Sound" />)
    expect(getByRole('switch').getAttribute('aria-checked')).toBe('false')
    rerender(<Switch checked onChange={() => {}} label="Sound" />)
    expect(getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('fires onChange when clicked', () => {
    const onChange = vi.fn()
    const { getByRole } = render(<Switch checked={false} onChange={onChange} label="Sound" />)
    fireEvent.click(getByRole('switch'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('carries the accessible name from label', () => {
    const { getByRole } = render(<Switch checked={false} onChange={() => {}} label="Chat sound" />)
    expect(getByRole('switch').getAttribute('aria-label')).toBe('Chat sound')
  })
})