import type { GmatchBridge, P2pFrame, P2pPeer, P2pStatus } from '../types/gmatch-bridge'

export type { P2pFrame, P2pPeer, P2pStatus }

/** Null-safe access: browser dev has no bridge, and every method is optional. */
export function getP2pBridge(): GmatchBridge | null {
  try {
    return typeof window !== 'undefined' ? (window.gmatch ?? null) : null
  } catch {
    return null
  }
}

export async function fetchP2pStatus(): Promise<P2pStatus> {
  try {
    const s = await getP2pBridge()?.p2pStatus?.()
    if (s && typeof s === 'object') return s
  } catch {
    /* bridge error reads as not-started */
  }
  return { started: false }
}

export async function sendP2pFrame(peer: string, binding: unknown, envelope: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await getP2pBridge()?.p2pSend?.({ peer, binding, envelope })
    if (r && typeof r === 'object') return r
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  return { ok: false, error: 'no p2p bridge' }
}

export function subscribeP2pFrames(cb: (frame: P2pFrame) => void): () => void {
  try {
    return getP2pBridge()?.onP2pMessage?.(cb) ?? (() => {})
  } catch {
    return () => {}
  }
}
