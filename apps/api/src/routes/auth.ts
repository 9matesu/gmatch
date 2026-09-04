import { Hono } from 'hono'
import { orbitAuth, issueNonce } from '../middleware/auth'
import type { D1Turso } from '../db'

type Bindings = {
  DB: D1Turso
}

const auth = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string, rawBody: string } }>()

auth.get('/nonce', orbitAuth, async (c) => {
  return issueNonce(c)
})

auth.post('/cleanup', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  await c.env.DB.prepare("DELETE FROM Sessions WHERE expires_at < datetime('now')").run()
  await c.env.DB.prepare("DELETE FROM Devices WHERE user_id = ? AND id NOT IN (SELECT id FROM Devices WHERE user_id = ? ORDER BY created_at DESC LIMIT 10)").bind(orbitId, orbitId).run()
  return c.json({ success: true, message: 'Expired sessions and excess devices cleaned up' })
})

auth.post('/passkeys/register/options', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const publicKeyHex = c.get('publicKeyHex')

  // Ensure user exists
  await c.env.DB.prepare('INSERT OR IGNORE INTO Users (id, public_key) VALUES (?, ?)').bind(orbitId, publicKeyHex).run()

  // Generate a simple challenge
  const challenge = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO Sessions (id, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)').bind(
    sessionId, 
    orbitId, 
    challenge, 
    new Date(Date.now() + 5*60000).toISOString()
  ).run()

  return c.json({
    options: {
      challenge,
      rp: { name: 'ORBIT', id: 'localhost' },
      user: { id: new TextEncoder().encode(orbitId), name: orbitId, displayName: orbitId },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
    },
    sessionId,
  })
})

auth.post('/passkeys/register/verify', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const { sessionId } = JSON.parse(c.get('rawBody'))

  // Get challenge
  const session = await c.env.DB.prepare('SELECT challenge FROM Sessions WHERE id = ? AND user_id = ?').bind(sessionId, orbitId).first<{challenge: string}>()
  if (!session) return c.json({ error: 'Invalid or expired session' }, 400)

  // Store credential
  await c.env.DB.prepare('INSERT INTO Devices (id, user_id, credential_id, public_key) VALUES (?, ?, ?, ?)').bind(
    crypto.randomUUID(), orbitId, 'passkey-cred', 'passkey-pub'
  ).run()

  // Delete session
  await c.env.DB.prepare('DELETE FROM Sessions WHERE id = ?').bind(sessionId).run()

  return c.json({ success: true })
})

export { auth }
