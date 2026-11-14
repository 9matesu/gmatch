import {
  json,
  preflight,
  readBody,
  readDirectory,
  writeDirectory,
  fresh,
  isRecord,
  type Env,
  type DirectoryRow,
} from '../_courier'

export const onRequestGet: PagesFunction<Env> = async (context) =>
  json({ servers: fresh(await readDirectory(context.env.MAIL)) })

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = await readBody<Record<string, unknown>>(context.request)
  if (!isRecord(body) || typeof body.id !== 'string' || typeof body.name !== 'string' || !body.name.trim()) {
    return json({ error: 'id and name required' }, 400)
  }

  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null)

  const rows = fresh(await readDirectory(context.env.MAIL))
  const row: DirectoryRow = {
    id: body.id,
    name: body.name.trim().slice(0, 60),
    description: str(body.description, 200)?.trim() || undefined,
    owner_id: typeof body.owner_id === 'string' ? body.owner_id : '',
    password_required: body.password_required ? 1 : 0,
    endpoint_hint: str(body.endpoint_hint, 200) || undefined,
    is_private: body.private === true || body.is_private === 1 ? 1 : 0,
    tags: Array.isArray(body.tags)
      ? body.tags.filter((t): t is string => typeof t === 'string').slice(0, 8)
      : undefined,
    user_count: num(body.user_count),
    online_count: num(body.online_count),
    last_seen: new Date().toISOString(),
  }

  const idx = rows.findIndex((r) => r.id === row.id)
  if (idx >= 0) rows[idx] = { ...rows[idx], ...row }
  else rows.unshift(row)
  await writeDirectory(context.env.MAIL, rows)
  return json({ ok: true, id: row.id })
}

export const onRequestOptions: PagesFunction<Env> = () => preflight()