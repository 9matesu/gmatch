/**
 * Toasts are owned by the header notifications tab (Header.tsx) so gameplay
 * never gets overlay-spammed. This component stays mounted for backwards
 * compat but renders nothing.
 */
export default function Toasts() {
  return null
}
