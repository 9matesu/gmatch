// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentUploadModal } from './AttachmentUploadModal';
import { orbitFetch } from '../utils/api';

vi.mock('../utils/api', () => ({ orbitFetch: vi.fn() }));
vi.mock('../utils/sounds', () => ({ playPress: vi.fn() }));
vi.mock('../hooks/useCropper', () => ({ useCropper: () => ({ crop: vi.fn(), cropper: null }) }));
vi.mock('./CropModal', () => ({ isCropableImage: () => false }));

const forgeMock = vi.hoisted(() => vi.fn());
vi.mock('../services/mediaForge', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  forgeMediaLocally: forgeMock,
}));

const rememberKeepMock = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../utils/mediaVault', () => ({ rememberUploadedMediaKeep: rememberKeepMock }));

const identity = { orbitId: 'me-1', publicKeyHex: 'pk', privateKeyHex: 'sk' } as never;
const HASH = 'c'.repeat(64);

beforeEach(() => {
  vi.mocked(orbitFetch).mockReset();
  rememberKeepMock.mockClear();
  forgeMock.mockReset();
  forgeMock.mockResolvedValue({
    id: 'chat-upload-1', contentHash: HASH, mimeType: 'video/mp4',
    sizeBytes: 1024, localUrl: 'blob:local', magnetUri: '',
  });
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:preview');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});

describe('chat attachment upload classification', () => {
  it('forges a private chat attachment and a Vault keep, never a card', async () => {
    const onSuccess = vi.fn();
    const file = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' });
    render(
      <AttachmentUploadModal
        isOpen
        identity={identity}
        recipientId="peer-1"
        initialFiles={[file]}
        onSuccess={onSuccess}
        onClose={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }));

    await waitFor(() => expect(forgeMock).toHaveBeenCalledTimes(1));
    expect(forgeMock).toHaveBeenCalledWith(file, identity, expect.objectContaining({
      isPublic: false,
      isChat: true,
      recipients: 'peer-1',
    }));
    expect(vi.mocked(orbitFetch).mock.calls.some(([url]) => String(url).includes('/api/cards'))).toBe(false);
    expect(onSuccess).toHaveBeenCalledWith({ id: 'chat-upload-1', url: '/api/objects/chat-upload-1', isVideo: true });
    await waitFor(() =>
      expect(rememberKeepMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'chat-upload-1', contentHash: HASH, mimeType: 'video/mp4' }),
        expect.anything(),
      ),
    );
  });

  it('still reports attach success when the Vault cannot confirm the bytes', async () => {
    rememberKeepMock.mockResolvedValueOnce(null);
    const onSuccess = vi.fn();
    const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' });
    render(
      <AttachmentUploadModal isOpen identity={identity} initialFiles={[file]} onSuccess={onSuccess} onClose={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
