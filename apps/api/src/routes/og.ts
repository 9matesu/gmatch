import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'

type Bindings = { DB: D1Turso }

const og = new Hono<{ Bindings: Bindings, Variables: { orbitId: string } }>()

const ogCache = new Map<string, { data: any, expiry: number }>()
const OG_CACHE_TTL = 300_000

og.get('/', orbitAuth, async (c) => {
  const urlParam = c.req.query('url')
  if (!urlParam) return c.json({ error: 'Missing url parameter' }, 400)

  const cacheKey = urlParam.toLowerCase()
  const cached = ogCache.get(cacheKey)
  if (cached && cached.expiry > Date.now()) {
    return c.json(cached.data)
  }

  let parsed: URL
  try {
    parsed = new URL(urlParam)
  } catch {
    return c.json({ error: 'Invalid URL' }, 400)
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return c.json({ error: 'Only http/https URLs are allowed' }, 400)
  }

  // Block private IPs (basic check)
  const hostname = parsed.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.16.') ||
    hostname.startsWith('192.168.') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return c.json({ error: 'URL not allowed' }, 400)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(urlParam, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Orbit-OG/1.0',
        'Accept': 'text/html',
      },
    })
    clearTimeout(timeout)

    if (!res.ok) return c.json({ error: 'Failed to fetch URL' }, 502)

    const html = await res.text()
    // Limit body size
    const body = html.slice(0, 100_000)

    const meta: Record<string, string> = {}

    // Extract OG meta tags via simple regex
    const ogRegex = /<meta\s+(?:property|name)=["'](og:|twitter:)?([^"']+)["']\s+content=["']([^"']*)["']/gi
    let match
    while ((match = ogRegex.exec(body)) !== null) {
      const key = match[2].toLowerCase()
      const value = match[3]
      if (key && value && !meta[key]) meta[key] = value
    }

    // Also match reversed attribute order
    const ogRegex2 = /<meta\s+content=["']([^"']*)["']\s+(?:property|name)=["'](og:|twitter:)?([^"']+)["']/gi
    while ((match = ogRegex2.exec(body)) !== null) {
      const key = match[3].toLowerCase()
      const value = match[1]
      if (key && value && !meta[key]) meta[key] = value
    }

    // Extract title from <title> if no og:title
    if (!meta['title']) {
      const titleMatch = /<title>([^<]+)<\/title>/i.exec(body)
      if (titleMatch) meta['title'] = titleMatch[1].trim()
    }

    // Extract description from <meta name="description">
    if (!meta['description']) {
      const descMatch = /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(body)
      if (descMatch) meta['description'] = descMatch[1]
    }

    const result = {
      title: meta['title'] || null,
      description: meta['description'] || null,
      image: meta['image'] || null,
      site_name: meta['site_name'] || null,
    }

    if (ogCache.size > 1000) {
      const oldest = ogCache.keys().next().value
      if (oldest) ogCache.delete(oldest)
    }
    ogCache.set(cacheKey, { data: result, expiry: Date.now() + OG_CACHE_TTL })

    return c.json(result)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return c.json({ error: 'Request timed out' }, 504)
    }
    return c.json({ error: 'Failed to fetch URL' }, 502)
  }
})

export { og }
