import { json, preflight, type Env } from '../../_courier'

// A courier has no LAN address and no world: answering this keeps the client's
// node probe on the same shape it already understands.
export const onRequestGet: PagesFunction<Env> = () =>
  json({ server: { name: 'gmatch rendezvous', directoryId: null, lanUrls: [] } })

export const onRequestOptions: PagesFunction<Env> = () => preflight()