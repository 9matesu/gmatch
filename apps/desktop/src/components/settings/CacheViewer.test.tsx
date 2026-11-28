// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CacheViewer, selectCacheRows } from './CacheViewer';
import { getAllObjects, type StoredObject } from '../../utils/storage';
import { localObjectBlobUrl } from '../../utils/mediaData';
import { saveMediaAsKeepsake } from '../../services/keepsake';

vi.mock('../../utils/storage', () => ({ getAllObjects: vi.fn(async () => []) }));
vi.mock('../../utils/mediaData', () => ({
  localObjectBlobUrl: vi.fn((id: string, data: ArrayBuffer | undefined) =>
    data && data.byteLength > 0 ? `blob:${id}` : ''),
}));
vi.mock('../../services/keepsake', () => ({
  saveMediaAsKeepsake: vi.fn(async () => ({ ok: true, ref: 'hash' })),
}));

const mockedGetAll = vi.mocked(getAllObjects);
const mockedSaveKeep = vi.mocked(saveMediaAsKeepsake);

function row(id: string, bytes: number[], createdAt: string): StoredObject {
  return {
    id,
    name: id,
    mime_type: 'image/jpeg',
    size_bytes: bytes.length,
    owner_id: 'owner',
    sender_pubkey: '',
    sender_enc_pubkey: '',
    created_at: createdAt,
    data: new Uint8Array(bytes).buffer,
  } as StoredObject;
}

const OLD = row('obj-old', [1, 2, 3], '2026-11-20T09:00:00Z');
const ALIAS = row('sha256-alias', [1, 2, 3], '2026-11-27T09:00:00Z');
const OTHER = row('obj-other', [9, 8], '2026-11-25T09:00:00Z');
const NO_BYTES = row('no-bytes', [], '2026-11-28T09:00:00Z');

describe('CacheViewer selection (read-only picture list)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetAll.mockResolvedValue([]);
  });

  it('deduplicates byte-identical rows by content hash and omits unresolvable bytes', () => {
    const { rows, urls } = selectCacheRows([NO_BYTES, OLD, ALIAS, OTHER]);
    // The newer alias wins over the older row holding the same picture.
    expect(rows.map((o) => o.id)).toEqual(['sha256-alias', 'obj-other']);
    expect(urls['sha256-alias']).toBe('blob:sha256-alias');
    expect(urls['obj-old']).toBeUndefined();
    expect(urls['no-bytes']).toBeUndefined();
  });

  it('renders one tile per unique resolvable picture with an honest count', async () => {
    mockedGetAll.mockResolvedValue([NO_BYTES, OLD, ALIAS, OTHER]);
    render(<CacheViewer />);
    await waitFor(() => expect(screen.getByText(/Cached media \(2\)/)).toBeTruthy());
    const tiles = screen.getAllByRole('button', { name: /save to vault/i });
    expect(tiles).toHaveLength(2);
    const imgs = document.querySelectorAll('img');
    expect(imgs).toHaveLength(2);
    for (const img of imgs) expect(img.getAttribute('src')).toBeTruthy();
  });

  it('shows a zero/honest empty state when nothing can be resolved', async () => {
    mockedGetAll.mockResolvedValue([NO_BYTES]);
    render(<CacheViewer />);
    await waitFor(() => expect(screen.getByText(/Cached media \(0\)/)).toBeTruthy());
    expect(screen.getByText(/Nothing cached yet/i)).toBeTruthy();
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('saves a tile as a verified keepsake and never deletes or evicts a cached picture', async () => {
    mockedGetAll.mockResolvedValue([ALIAS]);
    const toast = vi.fn();
    render(<CacheViewer toast={toast} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /save to vault/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /save to vault/i }));
    await waitFor(() => expect(mockedSaveKeep).toHaveBeenCalledWith(
      'sha256-alias',
      expect.objectContaining({ kind: 'image', bytes: expect.any(Blob) }),
    ));
    expect(toast).toHaveBeenCalledWith('Saved to your Vault and Keepsakes', 'success');
    expect(mockedGetAll).toHaveBeenCalledTimes(1);
    expect(localObjectBlobUrl).toHaveBeenCalledTimes(1);
  });

  it('reports an unverified save honestly instead of claiming it worked', async () => {
    mockedGetAll.mockResolvedValue([ALIAS]);
    mockedSaveKeep.mockResolvedValueOnce({ ok: false, reason: 'vault-unverified' });
    const toast = vi.fn();
    render(<CacheViewer toast={toast} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /save to vault/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /save to vault/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      'Could not save to vault: vault-unverified', 'error',
    ));
  });
});
