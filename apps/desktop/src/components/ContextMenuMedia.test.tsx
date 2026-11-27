// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MediaContextMenu } from './ContextMenuMedia'

const ctx = (data: Record<string, unknown>) => ({ x: 10, y: 10, type: 'media' as const, data })
const toast = vi.fn()

describe('MediaContextMenu repost actions', () => {
  it('a plain image has exactly one repost, wired to the caller', () => {
    render(
      <MediaContextMenu
        ctx={ctx({ src: 'https://example.com/a.jpg' })}
        onDismiss={() => {}}
        toast={toast}
        onRepostImage={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('menuitem', { name: 'Repost to feed' })).toHaveLength(1)
  })

  it('a keepsake has exactly one repost (the gallery bridge one)', () => {
    render(
      <MediaContextMenu
        ctx={ctx({ src: 'gmcache://abc', keepsakeId: 'keep-1' })}
        onDismiss={() => {}}
        toast={toast}
        onRepostImage={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('menuitem', { name: 'Repost to feed' })).toHaveLength(1)
    // Every keepsake action is still offered.
    expect(screen.getByRole('menuitem', { name: 'Add to story' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Delete keepsake' })).toBeTruthy()
  })
})
