// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { generateIdentity } from '@orbit/crypto'
import { AttachmentUploadModal } from './AttachmentUploadModal'

// Stub the cropper so ingesting an image paste cannot open a real crop
// dialog — the assertion is that the file reaches the form state at all.
// vi.mock is hoisted above the component's import, so the mock still applies.
vi.mock('../hooks/useCropper', () => ({
  useCropper: () => ({
    crop: async (f: File) => ({ file: f }),
    cropper: null,
  }),
}))

/**
 * A pasted image must travel the SAME path as a browsed one. The composer hands
 * the file to this modal (rather than uploading it itself) precisely so there
 * is one upload path: crop, preview, validation and the zero-binary P2P
 * registration. These tests pin that pre-seeded files actually land in the
 * form state, instead of the modal opening empty.
 */

const identity = generateIdentity()
const noop = () => {}

function renderModal(props: Partial<Parameters<typeof AttachmentUploadModal>[0]> = {}) {
  return render(
    <AttachmentUploadModal
      isOpen
      onClose={noop}
      onSuccess={vi.fn()}
      identity={identity as never}
      {...props}
    />,
  )
}

const png = () => new File([new Uint8Array([1, 2, 3])], 'pasted.png', { type: 'image/png' })

describe('AttachmentUploadModal pre-seeded from a paste', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ingests a pasted file into the form', async () => {
    renderModal({ initialFiles: [png()] })

    // The Attach button only goes live once fileRef is populated, so its
    // enabled state is the observable proof the paste was ingested.
    const attach = screen.getByRole('button', { name: /^attach$/i })
    await waitFor(() => expect(attach).not.toBeDisabled())
  })

  it('leaves the Attach button dead with no file and no link', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /^attach$/i })).toBeDisabled()
  })

  it('opens in URL mode with a pasted link prefilled', async () => {
    renderModal({ initialUrl: 'https://cdn.example/a.jpg' })
    await waitFor(() => {
      const input = screen.getByDisplayValue('https://cdn.example/a.jpg')
      expect(input).toBeTruthy()
    })
  })

  it('stays empty with neither a file nor a link', () => {
    renderModal()
    expect(screen.queryByDisplayValue(/cdn\.example/)).toBeNull()
  })
})
