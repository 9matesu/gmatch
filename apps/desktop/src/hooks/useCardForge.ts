import { useCallback, useState } from 'react'

export interface CardForgeOpen {
  /** Starter requirement copy (e.g. "build 5 cards to duel"). */
  needed?: number
  /** A keepsake chosen elsewhere (profile, feed, gallery). */
  prefill?: { url: string; tags: string[]; name: string } | null
  /** A local file already in hand (drop/paste path). */
  file?: File | null
}

/**
 * Card forge: one entry point for the three ways it opens (starter requirement,
//  media prefill, local file), and one place that owns the modal state.
 */
export function useCardForge() {
  const [isOpen, setOpen] = useState(false)
  const [needed, setNeeded] = useState(0)
  const [prefill, setPrefill] = useState<CardForgeOpen['prefill']>(null)
  const [file, setFile] = useState<File | null>(null)

  const openForge = useCallback((opts: CardForgeOpen = {}) => {
    setNeeded(opts.needed ?? 0)
    setPrefill(opts.prefill ?? null)
    setFile(opts.file ?? null)
    setOpen(true)
  }, [])

  const closeForge = useCallback(() => {
    setOpen(false)
    setPrefill(null)
    setFile(null)
    setNeeded(0)
  }, [])

  /** Adjust the open modal without reopening it (e.g. after a card is created). */
  const updateForge = useCallback((opts: CardForgeOpen) => {
    if (opts.needed !== undefined) setNeeded(opts.needed)
    if (opts.prefill !== undefined) setPrefill(opts.prefill)
    if (opts.file !== undefined) setFile(opts.file)
  }, [])

  return { isOpen, needed, prefill, file, openForge, closeForge, updateForge }
}