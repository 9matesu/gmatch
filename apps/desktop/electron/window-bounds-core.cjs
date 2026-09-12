// Validate saved BrowserWindow bounds against the primary work area:
// reject anything off-screen (monitor changed), clamp oversized windows.
function sanitizeBounds(b, workArea) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return null
  if (b.width < 800 || b.height < 600) return null
  // A title bar must be reachable: at least 200px of the top edge on screen.
  const visible = b.x + 200 < workArea.x + workArea.width && b.x + b.width - 200 > workArea.x &&
    b.y >= workArea.y && b.y + 40 < workArea.y + workArea.height
  if (!visible) return null
  return { x: b.x, y: b.y, width: Math.min(b.width, workArea.width), height: Math.min(b.height, workArea.height) }
}

module.exports = { sanitizeBounds }
