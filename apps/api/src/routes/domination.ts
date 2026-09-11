import { Hono } from 'hono'
import { D1Turso } from '../db'
import { orbitAuth } from '../middleware/auth'
import { logAdminAction } from '../admin-audit'
import { EconomyService } from '../economy'

import { isDefaultPeerName } from '@orbit/shared'

type Bindings = {
  DB: D1Turso
  BUCKET?: any
}

type Variables = {
  orbitId: string
  requestId: string
}

const domination = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/** Middleware: require authenticated user */
domination.use('*', orbitAuth)

/** GET /api/domination/settings - Get current user's domination settings */
domination.get('/settings', async (c) => {
  const userId = c.get('orbitId')
  const db = c.env.DB

  const row = await db.prepare('SELECT pc_domination_enabled, pc_domination_settings FROM Users WHERE id = ?')
    .bind(userId)
    .first<{ pc_domination_enabled: number; pc_domination_settings: string }>()

  if (!row) return c.json({ error: 'User not found' }, 404)

  return c.json({
    enabled: Boolean(row.pc_domination_enabled),
    settings: JSON.parse(row.pc_domination_settings || '{}')
  })
})

/** PUT /api/domination/settings - Update current user's domination settings */
domination.put('/settings', async (c) => {
  const userId = c.get('orbitId')
  const db = c.env.DB

  let body: any = {}
  try { body = await c.req.json() } catch { }

  const enabled = body.enabled !== undefined ? Boolean(body.enabled) : undefined
  const settings = body.settings !== undefined ? body.settings : undefined

  if (enabled === undefined && settings === undefined) {
    return c.json({ error: 'No fields to update' }, 400)
  }

  const updates: string[] = []
  const args: any[] = []

  if (enabled !== undefined) {
    updates.push('pc_domination_enabled = ?')
    args.push(enabled ? 1 : 0)
  }
  if (settings !== undefined) {
    updates.push('pc_domination_settings = ?')
    args.push(JSON.stringify(settings))
  }

  args.push(userId)
  const res = await db.prepare(`UPDATE Users SET ${updates.join(', ')} WHERE id = ?`).bind(...args).run()

  if ((res as any).changes === 0) return c.json({ error: 'User not found' }, 404)

  return c.json({ success: true })
})

/**
 * Domination economy: every action costs g$ from the authoritative ledger
 * (plan D4 — one wallet), and the victim is paid a consent cut. Costs scale
 * with intrusiveness; camera is the priciest and pays the victim most.
 */
export const DOMINATION_PRICES: Record<string, { cost: number; victimCut: number }> = {
  wallpaper: { cost: 250, victimCut: 0.4 },
  game_bg: { cost: 250, victimCut: 0.4 },
  text_overlay: { cost: 400, victimCut: 0.4 },
  message: { cost: 500, victimCut: 0.4 },
  blur: { cost: 800, victimCut: 0.5 },
  popup_video: { cost: 1200, victimCut: 0.5 },
  camera: { cost: 2500, victimCut: 0.6 },
}

/** GET /api/domination/prices - Public cost table (UI shows prices pre-purchase). */
domination.get('/prices', async (c) => {
  const prices: Record<string, number> = {}
  for (const [action, p] of Object.entries(DOMINATION_PRICES)) prices[action] = p.cost
  return c.json({ prices })
})
/** POST /api/domination/trigger - Trigger a domination action on a target user */
domination.post('/trigger', async (c) => {
  const dominatorId = c.get('orbitId')
  const db = c.env.DB

  let body: any = {}
  try { body = await c.req.json() } catch { }

  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : ''
  const action = typeof body.action === 'string' ? body.action.trim() : ''
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : undefined
  const intensity = typeof body.intensity === 'string' ? body.intensity : 'medium'

  if (!targetId) return c.json({ error: 'targetId is required' }, 400)
  if (!action) return c.json({ error: 'action is required' }, 400)

  const validActions = ['wallpaper', 'game_bg', 'popup_video', 'message', 'text_overlay', 'blur', 'camera']
  if (!validActions.includes(action)) {
    return c.json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` }, 400)
  }

  if (targetId === dominatorId) {
    return c.json({ error: 'Cannot target yourself' }, 400)
  }

  const victim = await db.prepare('SELECT id, last_seen, pc_domination_enabled, pc_domination_settings FROM Users WHERE id = ?')
    .bind(targetId)
    .first<{ id: string; last_seen: string | null; pc_domination_enabled: number; pc_domination_settings: string }>()

  if (!victim) return c.json({ error: 'Target user not found' }, 404)
  if (!victim.pc_domination_enabled) return c.json({ error: 'Target has not enabled PC Domination' }, 403)

  // Fire-and-forget over WS means an offline victim silently eats the fee —
  // refuse before charging anything instead.
  const lastSeenMs = victim.last_seen ? Date.parse(victim.last_seen) : 0
  if (Date.now() - lastSeenMs > 10 * 60_000) {
    return c.json({ error: 'They are offline right now — nothing was charged' }, 409)
  }

  // Per-action cooldown so a funded account cannot spam one player's screen.
  const recent = await db.prepare(`
    SELECT COUNT(*) as n FROM DominationActions
    WHERE dominator_id = ? AND victim_id = ? AND action = ? AND created_at > ?
  `).bind(dominatorId, targetId, action, new Date(Date.now() - 30_000).toISOString())
    .first<{ n: number }>()
  if (Number(recent?.n ?? 0) > 0) {
    return c.json({ error: 'Slow down — you just sent that one. Try again in half a minute.' }, 429)
  }

  const victimSettings = JSON.parse(victim.pc_domination_settings || '{}')

  const actionKeyMap: Record<string, string> = {
    wallpaper: 'allowDesktopBackgroundChange',
    game_bg: 'allowGameBackgroundChange',
    popup_video: 'allowPopupVideo',
    message: 'allowPopupMessage',
    text_overlay: 'allowTextOverlay',
    blur: 'allowBlurEverything',
    camera: 'allowRemoteCamera'
  }

  const requiredSetting = actionKeyMap[action]
  if (requiredSetting && !victimSettings[requiredSetting]) {
    return c.json({ error: `Target has not consented to ${action}` }, 403)
  }

  // If camera action is triggered, check if dominator requested public when victim only allows private
  if (action === 'camera' && payload?.isPublic && !victimSettings.allowPublicCamera) {
    // Override isPublic to false so it respects victim's private camera consent
    if (payload) payload.isPublic = false
  }

  const pricing = DOMINATION_PRICES[action]
  if (!pricing) return c.json({ error: `No price for action ${action}` }, 400)

  const actionId = crypto.randomUUID()
  const nowIso = new Date().toISOString()

  // Pay first: a dominator with an empty wallet cannot dominate anyone.
  // Idempotency key = actionId, so a retried trigger never double-charges.
  const economy = new EconomyService(db)
  try {
    await economy.debit(dominatorId, pricing.cost, {
      idempotencyKey: `dom-${actionId}`,
      kind: 'purchase',
      reference: `domination:${action}`,
    })
  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase()
    if (msg.includes('insufficient') || msg.includes('balance')) {
      return c.json({ error: `Not enough g$ — ${action} costs ${pricing.cost} g$`, cost: pricing.cost }, 402)
    }
    throw err
  }

  try {
    await db.prepare(`
      INSERT INTO DominationActions (id, dominator_id, victim_id, action, payload, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'sent', ?)
    `).bind(actionId, dominatorId, targetId, action, payload ? JSON.stringify(payload) : null, nowIso).run()
  } catch (err) {
    // Never keep the money when the action was not recorded.
    await economy.credit(dominatorId, pricing.cost, {
      idempotencyKey: `dom-refund-${actionId}`,
      kind: 'refund',
      reference: `domination-refund:${action}`,
    }).catch(() => { /* ledger alert below */ })
    console.error('[domination] insert failed, refunded', err)
    return c.json({ error: 'Could not record the action — your g$ were refunded' }, 500)
  }

  // Consent cut FIRST: the victim earns a share of the fee for hosting the
  // chaos, and the WS event carries the amount so the UI can celebrate it.
  const victimReward = Math.round(pricing.cost * pricing.victimCut)
  let paidVictim = false
  try {
    await economy.credit(targetId, victimReward, {
      idempotencyKey: `dom-pay-${actionId}`,
      kind: 'reward',
      reference: `domination-victim:${action}`,
    })
    paidVictim = true
  } catch (err) {
    console.warn('[domination] victim payout failed:', err)
  }

  const { broadcastToUser } = await import('../ws-bus')
  broadcastToUser(targetId, {
    type: 'domination',
    action,
    from: dominatorId,
    payload: { ...payload, actionId, intensity, victimReward: paidVictim ? victimReward : 0 },
    timestamp: nowIso
  })

  await logAdminAction(db, dominatorId, `domination_${action}`, { id: targetId, type: 'domination_target' }, JSON.stringify(payload))

  return c.json({ success: true, actionId, cost: pricing.cost, victimReward: paidVictim ? victimReward : 0 })
})

/** GET /api/domination/targets - Get list of users with domination enabled and their consent flags */
domination.get('/targets', async (c) => {
  const userId = c.get('orbitId')
  const db = c.env.DB

  const rows = await db.prepare(`
    SELECT id, display_name, pfp_url, pc_domination_enabled, pc_domination_settings, last_seen
    FROM Users
    WHERE id != ?
    ORDER BY last_seen DESC
    LIMIT 100
  `).bind(userId).all<{ id: string; display_name: string | null; pfp_url: string | null; pc_domination_enabled: number; pc_domination_settings: string; last_seen: string | null }>()

  // Only offer real, named players as targets — drop blank / whitespace / default
  // placeholder ("Unknown") accounts so they never appear in the picker.
  const targets: {
    id: string
    displayName: string
    pfpUrl: string | null
    enabled: boolean
    online: boolean
    last_seen: string | null
    consents: Record<string, boolean>
  }[] = []
  for (const u of rows.results || []) {
    const name = (u.display_name || '').trim()
    if (!name || isDefaultPeerName(name)) continue
    let settingsObj: Record<string, boolean> = {}
    try {
      settingsObj = JSON.parse(u.pc_domination_settings || '{}')
    } catch {}
    targets.push({
      id: u.id,
      displayName: name,
      pfpUrl: u.pfp_url,
      enabled: Boolean(u.pc_domination_enabled),
      // Same 10-min freshness rule the trigger gate enforces — the picker
      // must not offer people the server would refuse anyway.
      online: u.last_seen ? Date.now() - Date.parse(u.last_seen) < 10 * 60_000 : false,
      last_seen: u.last_seen ?? null,
      consents: settingsObj,
    })
  }

  return c.json({ targets })
})

/**
 * POST /api/domination/ack/:actionId - the VICTIM confirms an inbound effect
 * actually rendered. Until then the sender only sees "sent" (delivered to the
 * relay), never a fabricated "executed". Best-effort on the victim side.
 */
domination.post('/ack/:actionId', async (c) => {
  const userId = c.get('orbitId')
  const id = c.req.param('actionId')
  const row = await c.env.DB.prepare('SELECT victim_id, status FROM DominationActions WHERE id = ?')
    .bind(id).first<{ victim_id: string; status: string }>()
  if (!row) return c.json({ error: 'Action not found' }, 404)
  if (row.victim_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  if (row.status !== 'sent') return c.json({ ok: true, already: true })
  await c.env.DB.prepare("UPDATE DominationActions SET status = 'executed', executed_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id).run()
  return c.json({ ok: true })
})

/** GET /api/domination/history - Get domination action history for current user (as victim) */
domination.get('/history', async (c) => {
  const userId = c.get('orbitId')
  const db = c.env.DB

  const limit = Number(c.req.query('limit') || '50')
  const offset = Number(c.req.query('offset') || '0')

  const actions = await db.prepare(`
    SELECT da.*, u.display_name as dominator_name, u.pfp_url as dominator_pfp
    FROM DominationActions da
    LEFT JOIN Users u ON u.id = da.dominator_id
    WHERE da.victim_id = ?
    ORDER BY da.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(userId, limit, offset).all()

  return c.json({ actions: actions.results })
})

/** GET /api/domination/outgoing - Get domination actions sent by current user */
domination.get('/outgoing', async (c) => {
  const userId = c.get('orbitId')
  const db = c.env.DB

  const limit = Number(c.req.query('limit') || '50')
  const offset = Number(c.req.query('offset') || '0')

  const actions = await db.prepare(`
    SELECT da.*, u.display_name as victim_name, u.pfp_url as victim_pfp
    FROM DominationActions da
    LEFT JOIN Users u ON u.id = da.victim_id
    WHERE da.dominator_id = ?
    ORDER BY da.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(userId, limit, offset).all()

  return c.json({ actions: actions.results })
})

export default domination