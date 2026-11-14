import {
  json,
  preflight,
  readBody,
  readBox,
  writeBox,
  isRecord,
  MAIL_BOX_MAX,
  TOKEN_RE,
  type Env,
  type Envelope,
} from '../../_courier'

const badToken = () => json({ error: 'bad token' }, 400)

/** PUT /api/mail/:token — seal one envelope into the recipient's box. */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const token = context.params.token
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return badToken()

  const body = await readBody<Record<string, unknown>>(context.request)
  const env = isRecord(body) ? body.env : null
  if (!isRecord(env) || typeof env.sealed !== 'string' || env.sealed.length === 0) {
    return json({ error: 'env required' }, 400)
  }
  if (typeof env.id !== 'string' || env.id.length < 8 || env.id.length > 64) {
    return json({ error: 'env.id required' }, 400)
  }

  const box = await readBox(context.env.MAIL, token)
  if (box.length >= MAIL_BOX_MAX) return json({ error: 'mailbox full' }, 429)
  box.push(env as unknown as Envelope)
  await writeBox(context.env.MAIL, token, box)
  return json({ ok: true })
}

/** GET /api/mail/:token — drain a box (expired envelopes are dropped). */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const token = context.params.token
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return badToken()

  const now = Date.now()
  const live = (await readBox(context.env.MAIL, token)).filter((e) => !e.exp || e.exp > now)
  return json({ envelopes: live })
}

export const onRequestOptions: PagesFunction<Env> = () => preflight()