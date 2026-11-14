
export interface JustifiedInput {
  id: string
  /** width / height. Unknown until the bytes (or their header) are read. */
  ratio: number
}

export interface JustifiedRow {
  ids: string[]
  height: number
  /** True for the last row, which may stay shorter than the target. */
  last: boolean
}

export interface JustifiedOptions {
  containerWidth: number
  /** Preferred row height in px (220-280 is the sweet spot). */
  targetHeight?: number
  /** How far a row may be cropped from its natural height (0.12 = 12%). */
  maxCrop?: number
  gap?: number
}

/**
 * Justified rows (the Flickr/Tumblr algorithm): fill a row until its natural
 * height at 100% width drops under the target, then close it at exactly the
 * container width. Every row is a whole number of full-width tiles, so there is
 * no ragged bottom edge and no hole.
 *
 * Rows are a linear partition, so the result depends only on the ratios and the
 * width — never on the image decode. The caller measures ratios from metadata or
 * a probe and keeps an unmeasured tile out of the input, which is what makes the
 * layout shift zero instead of merely small.
 */
export function justifyRows(items: JustifiedInput[], opts: JustifiedOptions): { rows: JustifiedRow[]; height: number } {
  const target = opts.targetHeight ?? 240
  const maxCrop = opts.maxCrop ?? 0.12
  const gap = opts.gap ?? 4
  const width = Math.max(0, Math.floor(opts.containerWidth))

  const rows: JustifiedRow[] = []
  if (!items.length || width <= 0) return { rows, height: 0 }

  let row: JustifiedInput[] = []
  let ratioSum = 0

  const close = (last: boolean) => {
    if (!row.length) return
    const gaps = gap * (row.length - 1)
    const natural = (width - gaps) / ratioSum
    // Cropping a row means scaling it down until it fits the cap; the last row
    // keeps the target height instead of stretching a lone tile to full width.
    const height = row.length === 1 && last ? Math.min(target, natural) : natural
    const clamped = Math.max(target * (1 - maxCrop), Math.min(height, target * (1 + maxCrop)))
    rows.push({ ids: row.map((it) => it.id), height: Math.round(last && row.length === 1 ? clamped : height), last })
    row = []
    ratioSum = 0
  }

  for (const item of items) {
    if (!Number.isFinite(item.ratio) || item.ratio <= 0) continue
    row.push(item)
    ratioSum += item.ratio
    const gaps = gap * (row.length - 1)
    const natural = (width - gaps) / ratioSum
    if (natural <= target * (1 + maxCrop)) close(false)
  }
  close(true)

  const height = rows.reduce((sum, r) => sum + r.height + gap, -gap)
  return { rows, height }
}
