// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { FeedbackState } from './kit'
import { FEEDBACK } from './tokens'

/**
 * The feedback states are ONE recipe from tokens: a centred empty/loading/error
 * block for views and an inline status strip for rows. Callers supply words and
 * an optional action — never a colour, size or weight.
 */
describe('FeedbackState (empty / loading / error)', () => {
  it('renders an honest empty state without a spinner', () => {
    const { container } = render(
      <FeedbackState title="No posts yet." description="Upload a post, or join a node that has some." />,
    )
    expect((container.firstElementChild as HTMLElement).className).toContain(FEEDBACK.center)
    expect(screen.getByText('No posts yet.').className).toContain(FEEDBACK.title)
    expect(screen.getByText(/Upload a post/).className).toContain(FEEDBACK.description)
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('renders loading with the shared spinner and no error tint', () => {
    const { container } = render(<FeedbackState state="loading" title="Loading the feed…" />)
    expect(screen.getByText('Loading the feed…').className).toContain(FEEDBACK.title)
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.getByText('Loading the feed…').className).not.toContain('text-retro-error')
  })

  it('renders error with the one danger recipe and an action', () => {
    render(<FeedbackState state="error" title="Could not read the feed." action={<button>Retry</button>} />)
    expect(screen.getByText('Could not read the feed.').className).toContain(FEEDBACK.errorTitle)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('renders the inline strip recipe with its small spinner', () => {
    render(<FeedbackState layout="strip" state="loading" title="Loading media..." />)
    const status = screen.getByRole('status')
    expect(status.className).toContain(FEEDBACK.strip)
    expect(status.querySelector('.animate-spin')).not.toBeNull()
    expect(status).toHaveTextContent('Loading media...')
  })

  it('keeps the compact variant and forwards the host ref', () => {
    const ref = createRef<HTMLDivElement>()
    render(<FeedbackState compact ref={ref} title="No conversations yet" meta="Nothing here" />)
    expect(ref.current?.className).toContain(FEEDBACK.centerCompact)
    expect(screen.getByText('Nothing here').className).toContain(FEEDBACK.meta)
  })
})
