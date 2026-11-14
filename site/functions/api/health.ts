import { json, preflight, type Env } from '../_courier'

export const onRequestGet: PagesFunction<Env> = () => json({ ok: true, courier: true, version: 2 })

export const onRequestOptions: PagesFunction<Env> = () => preflight()