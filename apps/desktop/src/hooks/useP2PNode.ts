import { useCallback, useEffect, useState } from 'react'
import { fetchP2pStatus, sendP2pFrame, subscribeP2pFrames, type P2pFrame, type P2pStatus } from '../utils/p2pBridge'

// Minimal renderer side of the Slice 3 seam: main owns the libp2p node, this
// hook only reads status, sends sealed frames and collects inbound ones.
// Frame bodies stay sealed here; opening/validating is the caller's job.
export function useP2PNode() {
  const [status, setStatus] = useState<P2pStatus>({ started: false })
  const [frames, setFrames] = useState<P2pFrame[]>([])

  useEffect(() => {
    let alive = true
    fetchP2pStatus().then((s) => {
      if (alive) setStatus(s)
    })
    const off = subscribeP2pFrames((f) => {
      if (alive) setFrames((prev) => [...prev.slice(-99), f])
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const send = useCallback(
    (peer: string, binding: unknown, envelope: unknown) => sendP2pFrame(peer, binding, envelope),
    [],
  )

  return { status, frames, send }
}
