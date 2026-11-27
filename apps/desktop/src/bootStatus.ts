/**
 * The ONE boot screen's live status line.
 *
 * The static shell (`#boot` in index.html) paints before the bundle exists —
 * inline CSS, no JS — and owns the DOM. The bundle only does two things to it:
 * nudge the status text as boot progresses (node → identity → feed) and lift
 * the cover once the app has something real to show. Both are no-ops when the
 * cover is already gone (a warm reload, a test that mounts `App` directly), so
 * callers never have to guard.
 *
 * There is deliberately no progress bar and no timer here: the label reflects
 * what is actually being awaited, and nothing is faked or delayed.
 */
export function setBootStatus(label: string): void {
  if (typeof document === 'undefined') return
  const el = document.getElementById('boot-status')
  if (el && label) el.textContent = label
}

/** Lift the boot cover. Idempotent: removing an absent node is a no-op. */
export function markBootReady(): void {
  if (typeof document === 'undefined') return
  document.getElementById('boot')?.remove()
}