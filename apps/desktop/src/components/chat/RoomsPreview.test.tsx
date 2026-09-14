// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RoomsPreview, buildPreviewRows } from './RoomsPreview'

describe('buildPreviewRows', () => {
  it('orders lobby, queue, rooms, groups, dms and flags unread rooms', () => {
    const rows = buildPreviewRows({
      rooms: [{ id: 'r1', name: 'sealed room' }],
      roomLast: () => 'psst',
      roomUnread: () => true,
      groups: [{ id: 'g1', name: 'server group' }],
      groupLast: () => undefined,
      threads: [{ peer_id: 'me', peer_name: 'Self', last_sender_id: 'me' }, { peer_id: 'p1', peer_name: 'Peer', last_sender_id: 'p1' }],
      myOrbitId: 'me',
      readIds: new Set<string>(),
      lobbyLast: 'hi',
      queueLast: undefined,
    })
    expect(rows.map((r) => r.kind)).toEqual(['lobby', 'queue', 'room', 'group', 'dm'])
    expect(rows[2]).toMatchObject({ id: 'r1', last: 'psst', unread: true })
    // own thread excluded, peer dm included
    expect(rows.find((r) => r.id === 'me')).toBeUndefined()
    expect(rows.find((r) => r.id === 'p1')?.unread).toBe(true)
  })
})

describe('RoomsPreview', () => {
  it('row click opens that conversation; Open rooms goes to the full chat', () => {
    const onOpenRow = vi.fn()
    const onOpenAll = vi.fn()
    render(
      <RoomsPreview
        rows={[{ id: 'r1', kind: 'room', name: 'sealed room', last: 'psst', unread: true }]}
        onOpenRow={onOpenRow}
        onOpenAll={onOpenAll}
      />,
    )
    fireEvent.click(screen.getByText('sealed room'))
    expect(onOpenRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', kind: 'room' }))
    fireEvent.click(screen.getByText('Open rooms →'))
    expect(onOpenAll).toHaveBeenCalled()
  })
})
