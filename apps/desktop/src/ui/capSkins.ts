import type { CapId } from '../game/types'
import blueGif from '../assets/caps/blue.gif'
import filterGif from '../assets/caps/filter.gif'
import hypnoGif from '../assets/caps/hypno.gif'
import meltGif from '../assets/caps/melt.gif'

/**
 * Powerup button skins: hardcore gif loops bundled as static assets
 * (src/assets/caps, ~2MB total) — cached by the browser/Electron disk
 * cache, zero load wait. Keyed by stable cap id (names are flavor).
 */
export const CAP_SKINS: Record<CapId, string> = {
  blue: blueGif,
  filter: filterGif,
  hypno: hypnoGif,
  melt: meltGif,
}
