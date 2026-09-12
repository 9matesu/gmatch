import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from './logger';

afterEach(() => vi.unstubAllGlobals());

describe('logger', () => {
  it('forwards error calls to the gmatch bridge when present', () => {
    const logError = vi.fn();
    vi.stubGlobal('window', { gmatch: { logError } });
    logger.error('feed', new Error('boom'));
    expect(logError).toHaveBeenCalledWith('feed', expect.stringContaining('boom'));
  });
  it('never throws when the bridge is missing (browser mode)', () => {
    vi.stubGlobal('window', {});
    expect(() => logger.warn('x', 'y')).not.toThrow();
  });
});
