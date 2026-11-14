import {
  json,
  preflight,
  readBody,
  readBox,
  writeBox,
  isRecord,
  TOKEN_RE,
  type Env,
} from '../../../_courier'

/** POST /api/mail/:token/ack — consume the ids the recipient actually opened. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const token = context.params.token
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return json({ error: 'bad token' }, 400)

  const body = await readBody<Record<string, unknown>>(context.request)
  const ids = isRecord(body) && Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === 'string')
    : []
  if (ids.length > 0) {
    const drop = new Set(ids)
    await writeBox(
      context.env.MAIL,
      token,
      (await readBox(context.env.MAIL, token)).filter((e) => !drop.has(e.id ?? '')),
    )
  }
  return json({ ok: true })
}

export const onRequestOptions: PagesFunction<Env> = () => preflight()