// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileView } from './ProfileView'

vi.mock('../../hooks/useCropper', () => ({
  useCropper: () => ({ crop: vi.fn().mockResolvedValue({ dataUrl: '', file: null }), cropper: null }),
}))
vi.mock('../../utils/sounds', () => ({ playPress: vi.fn(), playWin: vi.fn() }))
vi.mock('../../utils/profile', () => ({ saveUserProfile: vi.fn() }))

const identity = { orbitId: 'me', publicKey: 'pk' } as any
const post = {
  id: 'profile-text-1', author_id: 'me', author_name: 'Me', caption: 'Words to repost',
  url: '', created_at: '2026-10-26T12:00:00.000Z', like_count: 0, comment_count: 0,
} as any

function renderProfile(onRepostPost: (p: any) => void) {
  const noop = vi.fn()
  render(
    <ProfileView
      identity={identity}
      myUser={{ id: 'me', display_name: 'Me' } as any}
      profilePics={{}}
      feedPosts={[post]}
      savedPosts={[]}
      myCards={[]}
      repostedPosts={[]}
      followingIds={[]}
      myProfile={{ displayName: 'Me', tags: [], isAdmin: false, pfpUrl: '', bio: '', website: '' }}
      toast={noop}
      setShowSettingsModal={noop}
      setFollowersModalState={noop as any}
      setExpandedItemId={noop}
      setMyProfile={noop as any}
      setProfilePics={noop as any}
      loadUsers={noop}
      setArchivedPostIds={noop as any}
      setDeletedPostIds={noop as any}
      deletePostOnServer={vi.fn().mockResolvedValue('deleted')}
      users={[]}
      onSendDm={vi.fn().mockResolvedValue(true)}
      onPersistLike={vi.fn().mockResolvedValue(undefined)}
      onPersistSave={noop}
      onPersistComment={vi.fn().mockResolvedValue(null)}
      onSelectUser={noop}
      onOpenNetwork={noop}
      shareGroups={[]}
      onRepostPost={onRepostPost}
    />,
  )
}

describe('ProfileView repost prop chain', () => {
  it('passes onRepostPost to the profile text card as exactly one action', async () => {
    const onRepostPost = vi.fn()
    renderProfile(onRepostPost)
    const actions = screen.getAllByRole('button', { name: 'Repost to Profile' })
    expect(actions).toHaveLength(1)
    await userEvent.click(actions[0])
    expect(onRepostPost).toHaveBeenCalledTimes(1)
    expect(onRepostPost).toHaveBeenCalledWith(post)
  })
})
