// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readClipboard } from './DropZone'

/**
 * The paste contract shared by the DropZone and the chat composer. Getting this
 * wrong is why pasting an image into a conversation did nothing: the
 * composer's <form> sits outside the DropZone, so it needs the same reader
 * rather than a second, subtly different implementation.
 */

function clipboardWith(opts: { files?: File[]; text?: string }): { clipboardData: DataTransfer } {
  const files = opts.files ?? []
  const text = opts.text ?? ''
  return {
    clipboardData: {
      items: files.map((f) => ({ kind: 'file', getAsFile: () => f })),
      getData: (type: string) => (type === 'text' ? text : ''),
      files,
    } as unknown as DataTransfer,
  }
}

const png = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
const mp4 = new File([new Uint8Array([1])], 'a.mp4', { type: 'video/mp4' })

describe('readClipboard', () => {
  it('reads a copied image as files', () => {
    const p = readClipboard(clipboardWith({ files: [png] }))
    expect(p.kind).toBe('files')
    if (p.kind === 'files') expect(p.files).toEqual([png])
  })

  it('reads several files at once', () => {
    const p = readClipboard(clipboardWith({ files: [png, mp4] }))
    expect(p.kind).toBe('files')
    if (p.kind === 'files') expect(p.files).toHaveLength(2)
  })

  it('prefers the image over the text flavour', () => {
    // Copying an image out of a browser puts a blob AND an html/text flavour
    // on the clipboard. The blob is what the player meant.
    const p = readClipboard(clipboardWith({ files: [png], text: 'https://example.com/page' }))
    expect(p.kind).toBe('files')
  })

  it('reads an http(s) link as a url', () => {
    expect(readClipboard(clipboardWith({ text: 'https://cdn.example/a.jpg' }))).toEqual({
      kind: 'url',
      url: 'https://cdn.example/a.jpg',
    })
    expect(readClipboard(clipboardWith({ text: 'http://cdn.example/a.jpg' })).kind).toBe('url')
  })

  it('reads a data: URI as a url', () => {
    const p = readClipboard(clipboardWith({ text: 'data:image/png;base64,iVBORw0KGgo=' }))
    expect(p.kind).toBe('url')
  })

  it('trims whitespace around a pasted link', () => {
    expect(readClipboard(clipboardWith({ text: '  https://cdn.example/a.jpg  ' }))).toEqual({
      kind: 'url',
      url: 'https://cdn.example/a.jpg',
    })
  })

  it('reports ordinary prose as text so the textarea can insert it', () => {
    // This distinction is what lets normal text pasting keep working: the
    // composer returns early on 'text' and lets the default happen.
    expect(readClipboard(clipboardWith({ text: 'hello there' }))).toEqual({ kind: 'text', text: 'hello there' })
  })

  it('reports nothing for an empty clipboard', () => {
    expect(readClipboard(clipboardWith({}))).toEqual({ kind: 'empty' })
  })

  it('survives a clipboard with no data at all', () => {
    expect(readClipboard({})).toEqual({ kind: 'empty' })
    expect(readClipboard({ clipboardData: null })).toEqual({ kind: 'empty' })
  })

  it('ignores a file item that yields no File', () => {
    const dt = {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => null }],
        getData: () => 'plain words',
      },
    } as unknown as { clipboardData: DataTransfer }
    expect(readClipboard(dt)).toEqual({ kind: 'text', text: 'plain words' })
  })
})
