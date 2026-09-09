import { Hono } from 'hono'
import type { D1Turso } from '../db'

type Bindings = { DB: D1Turso }

// Public, unauthenticated share pages (P3.5): the honest targets for
// "Copy Link" — a browser outside the app can open them. Minimal, static
// HTML; user content is escaped; app deep links ride the hash routes.
export const share = new Hono<{ Bindings: Bindings }>()

function esc(v: string): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeUrl(v: unknown): string {
  const s = String(v || '')
  return /^https?:\/\//.test(s) ? esc(s) : ''
}

function page(opts: { title: string; image?: string; bodyHtml: string }): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta property="og:title" content="${esc(opts.title)}">
${opts.image ? `<meta property="og:image" content="${opts.image}"><img src="${opts.image}" alt="" style="max-width:90vw;max-height:80vh;display:block;margin:24px auto;border-radius:12px">` : ''}
<style>body{background:#080A0D;color:#fafafa;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:40px 16px;text-align:center}a{color:#7dd3fc}.tag{font-size:12px;opacity:.6;margin-top:8px}</style>
</head><body>${opts.bodyHtml}
<p class="tag">gMatch — open in the desktop app</p>
</body></html>`
}

share.get('/p/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(
    `SELECT o.content_url, COALESCE(o.post_caption, o.caption) as caption, u.display_name
     FROM Objects o LEFT JOIN Users u ON u.id = o.owner_id
     WHERE o.id = ? AND o.is_public = 1 AND o.hidden_at IS NULL`,
  ).bind(id).first<{ content_url: string | null; caption: string | null; display_name: string | null }>()
  if (!row) return c.text('Not found', 404)
  const img = safeUrl(row.content_url)
  const title = row.caption ? `${row.caption.slice(0, 80)}` : `Post by ${row.display_name || 'a gooner'}`
  const body = `<h1>${esc(title)}</h1>${row.display_name ? `<p>by ${esc(row.display_name)}</p>` : ''}`
  return c.html(page({ title, image: img, bodyHtml: body }))
})

share.get('/u/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(
    'SELECT display_name, bio, pfp_url FROM Users WHERE id = ? AND hidden_at IS NULL',
  ).bind(id).first<{ display_name: string | null; bio: string | null; pfp_url: string | null }>()
  if (!row) return c.text('Not found', 404)
  const name = row.display_name || 'A gMatch player'
  const body = `<h1>${esc(name)}</h1>${row.bio ? `<p>${esc(row.bio.slice(0, 200))}</p>` : ''}`
  return c.html(page({ title: `${name} · gMatch`, image: safeUrl(row.pfp_url), bodyHtml: body }))
})
