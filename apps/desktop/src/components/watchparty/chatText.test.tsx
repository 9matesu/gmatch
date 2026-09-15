import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderChatText } from './chatText'

const render = (t: string) => renderToStaticMarkup(<>{renderChatText(t)}</>)

describe('renderChatText', () => {
  it('leaves plain text untouched', () => {
    expect(render('hello there')).toBe('hello there')
  })
  it('anchors a URL with rel=noopener', () => {
    const html = render('watch https://x.com/a.mp4 now')
    expect(html).toContain('<a href="https://x.com/a.mp4" target="_blank" rel="noopener noreferrer"')
    expect(html).toContain('watch ')
    expect(html).toContain(' now')
  })
  it('anchors two links and truncates long labels', () => {
    const long = `https://x.com/${'y'.repeat(60)}`
    const html = render(`${long} and ${long}`)
    expect((html.match(/<a /g) || []).length).toBe(2)
    // label truncated to the first 40 chars + ellipsis; href keeps the full URL
    expect(html).toContain(`${long.slice(0, 40)}...</a>`)
  })
})
