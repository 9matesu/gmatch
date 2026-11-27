"use client";

import { logger } from './logger';

/**
 * Copy text to the clipboard and report the REAL outcome.
 *
 * Three surfaces (share sheet, feed options, profile lightbox) each did
 * `navigator.clipboard?.writeText(...)` and then claimed success — and the
 * optional call meant a missing/absent clipboard resolved to `undefined`
 * rather than throwing, so the success toast fired on a copy that never
 * happened. The user found out when they pasted nothing.
 *
 * Returns true only when the write actually landed. A failure is reported as a
 * failure, and the caller decides what to do about it.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    // `clipboard` is undefined in insecure contexts and in some test
    // environments; treat that as a failure, not a success.
    if (!navigator.clipboard?.writeText) {
      logger.warn('[copyText] clipboard API unavailable');
      return false;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    logger.warn('[copyText] write failed', err);
    return false;
  }
}