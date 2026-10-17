// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { GroupsDialog } from './GroupsDialog'

afterEach(cleanup)

describe('GroupsDialog', () => {
  it('is explicit that a label is device-local, not a server', () => {
    render(<GroupsDialog open labels={[]} ownerId="me" onClose={() => {}} onSave={() => {}} />)
    expect(screen.getByRole('dialog', { name: /local groups/i })).toBeInTheDocument()
    expect(screen.getByText(/visible to nobody else/i)).toBeInTheDocument()
    expect(screen.getByText(/none yet/i)).toBeInTheDocument()
    // no hosting or joining affordance: a label is never a destination
    expect(screen.queryByRole('button', { name: /host a server/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /join/i })).toBeNull()
  })

  it('creates a label owned by this identity, then forgets it locally', () => {
    const onSave = vi.fn()
    const { rerender } = render(
      <GroupsDialog open labels={[]} ownerId="me" onClose={() => {}} onSave={onSave} />
    )
    fireEvent.change(screen.getByLabelText(/new group name/i), { target: { value: 'Friday crew' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const [next] = onSave.mock.calls[0] as [Array<{ name: string; ownerOrbitId: string }>]
    expect(next[0]).toMatchObject({ name: 'Friday crew', ownerOrbitId: 'me' })

    rerender(<GroupsDialog open labels={next as never} ownerId="me" onClose={() => {}} onSave={onSave} />)
    expect(screen.getByText(/0 peers/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /forget group friday crew/i }))
    expect(onSave).toHaveBeenLastCalledWith([])
  })

  it('renders nothing while closed', () => {
    const { container } = render(
      <GroupsDialog open={false} labels={[]} ownerId="me" onClose={() => {}} onSave={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
