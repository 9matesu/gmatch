// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GMatchFeed, type FeedPost } from './GMatchFeed';

vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(),
  playLike: vi.fn(),
  playWin: vi.fn(),
  playMsgReceive: vi.fn(),
}));

describe('GMatchFeed author and name click behavior', () => {
  const dummyPost: FeedPost = {
    id: 'post-1',
    author_id: 'user-alice',
    author_name: 'Alice Wonder',
    author_avatar: 'https://example.com/alice.jpg',
    url: 'https://example.com/media.jpg',
    created_at: new Date().toISOString(),
    like_count: 0,
    comment_count: 0,
  };

  const dummyStories = [
    { id: 'story-1', owner_id: 'user-alice', content_url: 'https://example.com/story.jpg', created_at: new Date().toISOString() } as any,
  ];

  it('clicking author name calls onSelectUser directly without opening story or picture lightbox', () => {
    const onOpenStory = vi.fn();
    const onSelectUser = vi.fn();

    render(
      <GMatchFeed
        identity={null}
        posts={[dummyPost]}
        stories={dummyStories}
        onOpenStory={onOpenStory}
        onSelectUser={onSelectUser}
      />
    );

    const nameEl = screen.getByText('Alice Wonder');
    fireEvent.click(nameEl);

    // Clicking name opens user profile directly
    expect(onOpenStory).not.toHaveBeenCalled();
    expect(onSelectUser).toHaveBeenCalledWith('user-alice');
    expect(screen.queryByRole('dialog', { name: /profile picture/i })).toBeNull();
  });

  it('clicking avatar ring calls onOpenStory when author has active stories', () => {
    const onOpenStory = vi.fn();

    render(
      <GMatchFeed
        identity={null}
        posts={[dummyPost]}
        stories={dummyStories}
        onOpenStory={onOpenStory}
      />
    );

    const avatarBtn = screen.getByTitle('Watch story');
    fireEvent.click(avatarBtn);

    expect(onOpenStory).toHaveBeenCalledWith('user-alice');
  });

  it('username and timestamp share the same leading so baselines align', () => {
    render(
      <GMatchFeed
        identity={null}
        posts={[dummyPost]}
        stories={dummyStories}
      />
    );

    const nameEl = screen.getByText('Alice Wonder');
    const row = nameEl.closest('div.flex');
    expect(row?.className).toMatch('items-baseline');
    expect(nameEl.className).toMatch('leading-tight');
    const timeEl = row?.querySelector('time');
    expect(timeEl?.className).toMatch('leading-tight');
    expect(timeEl?.className).toMatch('shrink-0');
  });
});
