// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GroupMembersPopover } from './GroupMembersPopover'

// UI-7: members visible inside a group chat + owner can add people.
function localStore() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', localStore())
})

const MEMBERS = [
  { id: 'aaa', display_name: 'Alice', is_owner: 1 },
  { id: 'bbb', display_name: 'Bob', is_owner: 0 },
]

describe('GroupMembersPopover', () => {
  it('lists members with owner marker', async () => {
    const load = vi.fn(async () => MEMBERS)
    render(<GroupMembersPopover groupId="g1" loadMembers={load} meId="aaa" />)
    await waitFor(() => expect(screen.getByText(/Alice/)).toBeInTheDocument())
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getAllByText(/owner/i).length).toBe(1)
    expect(load).toHaveBeenCalledWith('g1')
  })

  it('shows an "add people" picker only for the owner (non-member ids filtered)', async () => {
    const load = vi.fn(async () => MEMBERS)
    const add = vi.fn(async () => true)
    const peers = [
      { orbitId: 'aaa', name: 'Alice' },
      { orbitId: 'bbb', name: 'Bob' },
      { orbitId: 'ccc', name: 'Carol' },
    ]
    render(
      <GroupMembersPopover
        groupId="g1"
        loadMembers={load}
        meId="aaa"
        isOwner
        peers={peers}
        onAddMembers={add}
      />,
    )
    await waitFor(() => expect(screen.getByText(/Alice/)).toBeInTheDocument())
    // only non-members offered
    const pick = screen.getByRole('button', { name: /carol/i })
    expect(pick).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^bob$/i })).toBeNull()
    fireEvent.click(pick)
    fireEvent.click(screen.getByRole('button', { name: /add|invite/i }))
    await waitFor(() => expect(add).toHaveBeenCalledWith('g1', ['ccc']))
  })

  it('non-owner sees no add affordance', async () => {
    const load = vi.fn(async () => MEMBERS)
    render(
      <GroupMembersPopover groupId="g1" loadMembers={load} meId="bbb" peers={[{ orbitId: 'ccc', name: 'Carol' }]} onAddMembers={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText(/Alice/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /carol/i })).toBeNull()
  })

  it('load failure surfaces a retry, never a crash', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(MEMBERS)
    render(<GroupMembersPopover groupId="g1" loadMembers={load} meId="aaa" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getByText(/Alice/)).toBeInTheDocument())
  })
})
