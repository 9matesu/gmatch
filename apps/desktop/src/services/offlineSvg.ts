/**
 * Offline SVG placeholder (SPEC §6): gradient + tag text + OFFLINE badge,
 * returned as a data-URI. Pure string generation — no DOM needed.
 */
function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c,
  )
}

export function offlineSvg(tags: string[]): string {
  const label = (tags.slice(0, 3).join(' ') || 'gmatch').slice(0, 60)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#1a0b2e"/><stop offset="0.5" stop-color="#ff2d78" stop-opacity="0.35"/><stop offset="1" stop-color="#7b2ff7"/>
</linearGradient></defs>
<rect width="800" height="600" fill="url(#g)"/>
<text x="400" y="290" font-family="monospace" font-size="28" fill="rgba(255,255,255,0.85)" text-anchor="middle">${escapeXml(label)}</text>
<text x="400" y="335" font-family="monospace" font-size="16" fill="rgba(255,255,255,0.5)" text-anchor="middle">source offline — using placeholder</text>
<g transform="translate(640,32)">
<rect width="128" height="36" rx="8" fill="#ff2d78"/>
<text x="64" y="24" font-family="monospace" font-size="18" font-weight="bold" fill="#0a0a0f" text-anchor="middle">OFFLINE</text>
</g></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
