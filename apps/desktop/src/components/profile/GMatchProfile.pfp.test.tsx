// @vitest-environment jsdom
// The avatar is not allowed to vanish because a signed object fetch was slow or
// hit its 8s ceiling. Only a confirmed absence (the profile itself carries no
// photo) may replace it with the initial-letter fallback.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { GMatchProfile } from './GMatchProfile';

vi.mock('../../hooks/useCropper', () => ({
  useCropper: () => ({ crop: vi.fn().mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,cropped', file: null }), cropper: null }),
}));
vi.mock('../../utils/sounds', () => ({ playPress: vi.fn(), playWin: vi.fn() }));
vi.mock('../../utils/profile', () => ({ saveUserProfile: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }));

/** What the last rendered avatar image was handed. ObjectImage owns the retry
 *  wave; this stub only records the props and exposes its callbacks. */
let avatarProps: any = null;
vi.mock('../ObjectImage', () => ({
  ObjectImage: (props: any) => {
    avatarProps = props;
    return (
      <div data-testid="avatar-image" role="button"
        onClick={() => props.onMediaUnavailable?.()}
        onDoubleClick={() => props.onLoad?.()}
      />
    );
  },
}));

const identity = { orbitId: 'user_123', publicKeyHex: 'pk', privateKeyHex: 'sk' } as any;
const myUser = { id: 'user_123', display_name: 'Alice', pfp_url: '/api/objects/pfp-1' };

function renderProfile(overrides: Partial<React.ComponentProps<typeof GMatchProfile>> = {}) {
  return render(
    <GMatchProfile
      identity={identity}
      myUser={myUser}
      profilePic="/api/objects/pfp-1"
      posts={[]}
      cards={[]}
      {...overrides}
    />,
  );
}

describe('GMatchProfile avatar availability', () => {
  beforeEach(() => { avatarProps = null; });

  it('shows the initial on a terminal miss but keeps the ref through the retry wave', () => {
    renderProfile();
    expect(avatarProps.contentUrl).toBe('/api/objects/pfp-1');
    expect(avatarProps.hideUnavailable).toBe(true);
    // A confirmed miss shows the initial fallback — but the handler must only
    // mark the display, never erase the pfp ref: the SAME mounted ObjectImage
    // is still there for the retry to refill.
    expect(typeof avatarProps.onMediaUnavailable).toBe('function');
    expect(typeof avatarProps.onLoad).toBe('function');
    fireEvent.click(screen.getByTestId('avatar-image'));
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(avatarProps.contentUrl).toBe('/api/objects/pfp-1');
    expect(screen.getByTestId('avatar-image')).toBeInTheDocument();

    act(() => { window.dispatchEvent(new Event('gmatch-media-retry')); });
    expect(screen.queryByText('A')).toBeNull();
    expect(avatarProps.contentUrl).toBe('/api/objects/pfp-1');
    expect(screen.getByTestId('avatar-image')).toBeInTheDocument();
  });

  it('clears the fallback as soon as the bytes load', () => {
    renderProfile();
    fireEvent.click(screen.getByTestId('avatar-image'));
    expect(screen.getByText('A')).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByTestId('avatar-image'));
    expect(screen.queryByText('A')).toBeNull();
    expect(avatarProps.contentUrl).toBe('/api/objects/pfp-1');
  });

  it('falls back to the initial only when the profile confirms there is no photo', () => {
    const { rerender } = renderProfile();
    expect(screen.getByTestId('avatar-image')).toBeInTheDocument();

    rerender(
      <GMatchProfile
        identity={identity}
        myUser={{ ...myUser, pfp_url: '' }}
        profilePic=""
        posts={[]}
        cards={[]}
      />,
    );
    expect(screen.queryByTestId('avatar-image')).toBeNull();
  });
});
