// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfflineCard from './OfflineCard'

describe('OfflineCard (interaction)', () => {
  it('shows loading label and disables retry while fetching', () => {
    render(<OfflineCard fetching feedOffline={false} onRetry={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
    expect((screen.getByRole('button', { name: /retry/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('fires onRetry on click when offline', async () => {
    const onRetry = vi.fn()
    render(<OfflineCard fetching={false} feedOffline onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('clicks do not escape the card (stage stays safe)', async () => {
    const onStage = vi.fn()
    render(
      <div onClick={onStage}>
        <OfflineCard fetching={false} feedOffline={false} onRetry={() => {}} />
      </div>,
    )
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onStage).not.toHaveBeenCalled()
  })
})
