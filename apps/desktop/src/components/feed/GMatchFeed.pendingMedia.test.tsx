// @vitest-environment jsdom
// Universal posting: a post is content the moment it exists. A text-less row
// shows immediately; its media renders "No preview" until bytes arrive (bounded
// by ObjectImage), never a hidden row and never an endless spinner.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GMatchFeed } from './GMatchFeed';

const identity = { orbitId: 'me', publicKeyHex: 'aa', privateKeyHex: 'bb' } as never;

const imagePost = {
  id: 'pending-1',
  author_id: 'author-1',
  author_name: 'Au Thor',
  created_at: new Date().toISOString(),
  caption: '',
  url: 'https://cdn.test/pending.jpg',
  like_count: 0,
  comment_count: 0,
};

describe('a text-less post shows immediately', () => {
  it('renders the row without waiting for bytes', () => {
    const { container } = render(
      <GMatchFeed identity={identity} posts={[imagePost]} stories={[]} users={[]} />,
    );
    expect(container.querySelector('article')).not.toBeNull();
  });

  it('a captioned post shows its words', () => {
    render(
      <GMatchFeed
        identity={identity}
        posts={[{ ...imagePost, id: 'captioned', caption: 'words are content' }]}
        stories={[]}
        users={[]}
      />,
    );
    expect(screen.getByText('words are content')).toBeTruthy();
  });
});