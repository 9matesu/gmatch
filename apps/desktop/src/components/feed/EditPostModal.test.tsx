// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditPostModal } from './EditPostModal'

const post = { id: 'p1', caption: 'the old caption' }

describe('EditPostModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prefills the current caption', () => {
    render(<EditPostModal post={post} onClose={() => {}} onSave={() => {}} />)
    expect((screen.getByLabelText('Caption') as HTMLTextAreaElement).value).toBe('the old caption')
  })

  it('saves the edited caption', () => {
    const onSave = vi.fn()
    render(<EditPostModal post={post} onClose={() => {}} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'the new caption' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('the new caption')
  })

  it('Ctrl+Enter saves', () => {
    const onSave = vi.fn()
    render(<EditPostModal post={post} onClose={() => {}} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'quick' } })
    fireEvent.keyDown(screen.getByLabelText('Caption'), { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledWith('quick')
  })

  it('the Save button is disabled when nothing changed', () => {
    render(<EditPostModal post={post} onClose={() => {}} onSave={() => {}} />)
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('an empty caption is a valid CLEAR (not "unchanged")', () => {
    const onSave = vi.fn()
    render(<EditPostModal post={post} onClose={() => {}} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: '   ' } })
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('')
  })

  it('Cancel closes without saving', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<EditPostModal post={post} onClose={onClose} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('the field is capped at the protocol limit', () => {
    render(<EditPostModal post={post} onClose={() => {}} onSave={() => {}} />)
    expect((screen.getByLabelText('Caption') as HTMLTextAreaElement).maxLength).toBe(2000)
  })
})
