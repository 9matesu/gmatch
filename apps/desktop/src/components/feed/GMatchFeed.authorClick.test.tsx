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
  };

  const dummyStories = [
    { id: 'story-1', owner_id: 'user-alice', content_url: 'https://example.com/story.jpg', created_at: new Date().toISOString() } as any,
  ];

  it('clicking author name does NOT call onOpenStory even if author has active stories', () => {
    const onOpenStory = vi.fn();
    const onSelectUser = vi.fn();

    render(
      <GMatchFeed
        posts={[dummyPost]}
        stories={dummyStories}
        onOpenStory={onOpenStory}
        onSelectUser={onSelectUser}
      />
    );

    const nameEl = screen.getByText('Alice Wonder');
    fireEvent.click(nameEl);

    // Clicking name MUST NOT trigger story
    expect(onOpenStory).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /profile picture/i })).toBeDefined();
  });

  it('clicking avatar ring calls onOpenStory when author has active stories', () => {
    const onOpenStory = vi.fn();

    render(
      <GMatchFeed
        posts={[dummyPost]}
        stories={dummyStories}
        onOpenStory={onOpenStory}
      />
    );

    const avatarBtn = screen.getByTitle('Watch story');
    fireEvent.click(avatarBtn);

    expect(onOpenStory).toHaveBeenCalledWith('user-alice');
  });
});
