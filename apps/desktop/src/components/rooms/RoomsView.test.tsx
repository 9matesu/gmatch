// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RoomsView } from './RoomsView'
import type { Room } from '../../utils/rooms'

const room: Room = {
  id: 'r1',
  name: 'lounge',
  dekHex: 'ab'.repeat(32),
  epoch: 2,
  ownerId: 'me123',
  members: ['me123', 'peer456'],
  createdAt: 1,
}

function baseProps(over = {}) {
  return {
    rooms: [room],
    roomMessages: vi.fn(() => [{ id: 'm1', senderOrbitId: 'peer456', text: 'hello room', ts: 2 }]),
    users: [{ id: 'peer456', display_name: 'Peer One' } as never],
    myOrbitId: 'me123',
    onCreateRoom: vi.fn(() => ({ ...room, id: 'r2', name: 'new room', epoch: 1, members: ['me123'] })),
    onInvite: vi.fn(async () => true),
    onSay: vi.fn(async () => 'm2'),
    onLeave: vi.fn(),
    toast: vi.fn(),
    ...over,
  }
}

beforeEach(() => cleanup())

describe('RoomsView', () => {
  it('renders room list, member chips, and sealed history', () => {
    render(<RoomsView {...baseProps()} />)
    // 'lounge' renders twice on purpose (list row + chat header)
    expect(screen.getAllByText('lounge').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('hello room')).toBeInTheDocument()
    expect(screen.getByText(/epoch 2/)).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getAllByText('Peer One').length).toBeGreaterThanOrEqual(2) // chip + sender label
    // Owner is me -> no leave button
    expect(screen.queryByLabelText('Leave room')).toBeNull()
  })

  it('create flow: type name -> button calls onCreateRoom', () => {
    const props = baseProps()
    render(<RoomsView {...props} />)
    fireEvent.change(screen.getByPlaceholderText('new room name'), { target: { value: 'backroom' } })
    fireEvent.click(screen.getByLabelText('Create room'))
    expect(props.onCreateRoom).toHaveBeenCalledWith('backroom')
  })

  it('say flow: Enter sends trimmed draft via onSay', () => {
    const props = baseProps()
    render(<RoomsView {...props} />)
    const composer = screen.getByPlaceholderText(/Message lounge/i)
    fireEvent.change(composer, { target: { value: '  sup  ' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    expect(props.onSay).toHaveBeenCalledWith('r1', 'sup')
  })

  it('invite unknown contact -> error toast, no call', () => {
    const props = baseProps()
    render(<RoomsView {...props} />)
    fireEvent.change(screen.getByPlaceholderText(/invite a contact/i), { target: { value: 'nobody' } })
    fireEvent.click(screen.getByText('Invite'))
    expect(props.onInvite).not.toHaveBeenCalled()
    expect(props.toast).toHaveBeenCalledWith(expect.stringContaining('No contact'), 'error')
  })

  it('non-owner sees a working leave button', () => {
    const props = baseProps({ myOrbitId: 'peer456' })
    render(<RoomsView {...props} />)
    fireEvent.click(screen.getByLabelText('Leave room'))
    expect(props.onLeave).toHaveBeenCalledWith('r1')
  })

  it('empty state invites creating a room', () => {
    render(<RoomsView {...baseProps({ rooms: [] })} roomMessages={() => []} />)
    expect(screen.getAllByText(/end-to-end encrypted group chat/i).length).toBeGreaterThan(0)
  })
})
