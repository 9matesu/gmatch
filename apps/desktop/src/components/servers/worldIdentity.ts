/**
 * Presentation identity for a world (a server): a stable hue and glyph derived
 * from the world's canonical key.
 *
 * This is chrome, never data. It carries no reachability, membership or
 * ownership claim — two worlds that share a key look identical, and renaming a
 * world keeps its colour so the row stays recognisable. Pure and deterministic
 * so the same world paints the same way on every render and every device.
 */

/** Deterministic 0–359 hue for a canonical world key. */
export function worldHue(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0
  }
  return hash % 360
}

/** One visible character for a world's avatar tile; '?' when the name is empty. */
export function worldGlyph(name: string): string {
  const letters = (name || '').replace(/[^\p{L}\p{N}]/gu, '')
  return (letters[0] || '?').toUpperCase()
}

/** Inline style for the world's avatar tile. HSL keeps it readable on dark chrome. */
export function worldTileStyle(key: string): { background: string; borderColor: string } {
  const hue = worldHue(key)
  return {
    background: `linear-gradient(135deg, hsl(${hue} 55% 32%), hsl(${(hue + 38) % 360} 60% 18%))`,
    borderColor: `hsl(${hue} 60% 46% / 0.55)`,
  }
}

/** Inline style for the current-world rail / accent. */
export function worldAccentStyle(key: string): { backgroundColor: string } {
  return { backgroundColor: `hsl(${worldHue(key)} 70% 58%)` }
}
