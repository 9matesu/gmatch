import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidImageUrl, fetchUniversalFeed, isExplicitFeederImage } from './universalImageFeeder';

describe('universalImageFeeder', () => {
  describe('isValidImageUrl', () => {
    it('returns true for valid https and http URLs', () => {
      expect(isValidImageUrl('https://example.com/image.jpg')).toBe(true);
      expect(isValidImageUrl('http://example.com/image.png')).toBe(true);
      expect(isValidImageUrl('https://safebooru.org/images/123/abc.jpg')).toBe(true);
    });

    it('returns true for data:image URIs', () => {
      expect(isValidImageUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
    });

    it('returns false for null, undefined, or empty strings', () => {
      expect(isValidImageUrl(null)).toBe(false);
      expect(isValidImageUrl(undefined)).toBe(false);
      expect(isValidImageUrl('')).toBe(false);
      expect(isValidImageUrl('   ')).toBe(false);
    });

    it('returns false for invalid non-URL strings', () => {
      expect(isValidImageUrl('not-a-url')).toBe(false);
    });
  });

  describe('fetchUniversalFeed', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('falls back to curated feed backups when external fetch fails', async () => {
      // Mock fetch failure
      (global as any).fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

      const result = await fetchUniversalFeed({ limit: 4 });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(4);
      expect(result[0].source).toBe('curated');
    });

    it('parses valid booru/slideshow items when API succeeds', async () => {
      (global as any).fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          images: [
            {
              id: 'test_1',
              url: 'https://images.unsplash.com/photo-test1.jpg',
              author: 'bot_alpha',
              caption: 'Test art',
              tags: ['cyberpunk', 'anime'],
            },
          ],
        }),
      } as Response);

      const result = await fetchUniversalFeed({ limit: 1 });
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('test_1');
      expect(result[0].url).toBe('https://images.unsplash.com/photo-test1.jpg');
      expect(result[0].source).toBe('local_api');
    });
  });

  describe('isExplicitFeederImage', () => {
    it('recognizes provider ratings and normalized explicit tags', () => {
      expect(isExplicitFeederImage({ rating: 'explicit', tags: [] })).toBe(true);
      expect(isExplicitFeederImage({ rating: 'unknown', tags: ['uncensored_nudity'] })).toBe(true);
      expect(isExplicitFeederImage({ rating: 'safe', tags: ['landscape', 'anime'] })).toBe(false);
    });
  });
});
