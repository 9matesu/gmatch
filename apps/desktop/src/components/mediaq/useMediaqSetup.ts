/**
 * Mediaq is opt-in, not part of first-run.
 *
 * This hook used to open the one-shot installer on the very first launch (as
 * soon as the bridge reported mediaq missing), which put a media-suite modal
 * in front of the age gate and onboarding. Nothing is auto-shown on startup
 * any more: the installer stays reachable later from Settings → Preferences
 * (MediaqSection) and from the notification centre's "Show setup" button —
 * both call useMediaqInstall.openModal() directly.
 *
 * Kept as a hook because App.tsx calls it once at boot; it is deliberately a
 * no-op so future callers keep the same import path.
 */
export function useMediaqSetup(): void {
  return
}
