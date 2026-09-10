import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import { mintTurnCreds } from '../turn-creds'

/**
 * GET /api/turn/credentials — ephemeral relay creds from the ONE TURN server
 * (the site). Requires an orbitAuth-signed request (proof the caller holds a
 * keypair), but the minted username is RANDOM (never the orbitId), so coturn
 * access logs cannot attribute relay traffic to a person. When TURN_SECRET is
 * unset (dev/LAN/self-host without relay), returns { enabled: false } and the
 * client falls back to STUN-only — never a silent dead end.
 */
type Bindings = { DB?: unknown; BUCKET?: unknown }

export const turn = new Hono<{ Bindings: Bindings, Variables: { orbitId: string } }>()

turn.get('/credentials', orbitAuth, (c) => {
  const secret = process.env.TURN_SECRET
  if (!secret) return c.json({ enabled: false as const })
  const urls = (process.env.TURN_URLS || 'turn:turn.example.org:3478')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const ttl = Math.max(300, Number(process.env.TURN_TTL_S || 3600))
  const creds = mintTurnCreds(secret, urls, Date.now(), ttl)
  return c.json({ enabled: true as const, ...creds })
})
