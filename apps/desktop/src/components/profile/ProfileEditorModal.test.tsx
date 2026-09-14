// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileEditorModal } from './ProfileEditorModal';

vi.mock('../../utils/sounds', () => ({ playPress: vi.fn(), playWin: vi.fn() }));
vi.mock('../../utils/profile', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  saveUserProfile: vi.fn(async () => ({ ok: true, status: 200 })),
}));

import { saveUserProfile } from '../../utils/profile';

const identity = { orbitId: 'me-1' } as never;

beforeEach(() => {
  vi.mocked(saveUserProfile).mockClear();
  vi.mocked(saveUserProfile).mockResolvedValue({ ok: true, status: 200 });
});

describe('ProfileEditorModal tags', () => {
  it('renders initial tags as removable chips', async () => {
    render(
      <ProfileEditorModal
        identity={identity}
        initialName="Me"
        initialTags={['bbc', 'solo']}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('#bbc')).toBeInTheDocument();
    expect(screen.getByText('#solo')).toBeInTheDocument();
  });

  it('adds a tag from the input and saves tags with the profile', async () => {
    const onProfileUpdated = vi.fn();
    render(
      <ProfileEditorModal
        identity={identity}
        initialName="Me"
        initialTags={['bbc']}
        onClose={() => {}}
        onProfileUpdated={onProfileUpdated}
      />,
    );
    await userEvent.type(screen.getByPlaceholderText(/add a tag/i), 'Solo!');
    await userEvent.click(screen.getByRole('button', { name: /add tag/i }));
    expect(await screen.findByText('#solo')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^done$/i }));
    await waitFor(() => expect(saveUserProfile).toHaveBeenCalled());
    const patch = vi.mocked(saveUserProfile).mock.calls[0][1] as { tags?: string[] };
    expect(patch.tags).toEqual(expect.arrayContaining(['bbc', 'solo']));
    expect(onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({ tags: ['bbc', 'solo'] }));
  });

  it('removes a tag via its chip button', async () => {
    render(
      <ProfileEditorModal
        identity={identity}
        initialName="Me"
        initialTags={['bbc', 'solo']}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /remove tag bbc/i }));
    expect(screen.queryByText('#bbc')).not.toBeInTheDocument();
    expect(screen.getByText('#solo')).toBeInTheDocument();
  });
});
