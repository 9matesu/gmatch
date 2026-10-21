import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * API inventory guard (roadmap L7).
 *
 * Every node route the client calls must be classified in
 * `docs/API-INVENTORY.md` (role + migration target). A new route that is not
 * listed there fails this test, so the inventory cannot rot into a lie.
 */

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const INVENTORY = path.join(ROOT, 'docs', 'API-INVENTORY.md')
const SRC = path.join(ROOT, 'apps', 'desktop', 'src')

// `/api/posts/${id}/like?x=1` normalizes to `/api/posts/*/like`.
function normalizeRoute(route: string): string {
  return route
    .split('?')[0]
    .replace(/\$\{[^}]*\}/g, '*')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
}

// A quoted /api route right after orbitFetch( — \x60 is a backtick, written
// as an escape so the pattern itself stays quote-free.
const ROUTE_AFTER_CALL = /^\s*(['"]|\x60)(\/api\/[^'"\x60]*)\1/

function collectRoutes(dir: string, out = new Set<string>()): Set<string> {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      collectRoutes(full, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name) || name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
    const content = fs.readFileSync(full, 'utf8')
    let at = content.indexOf('orbitFetch(')
    while (at !== -1) {
      const rest = content.slice(at + 'orbitFetch('.length)
      const match = ROUTE_AFTER_CALL.exec(rest)
      if (match) out.add(normalizeRoute(match[2]))
      at = content.indexOf('orbitFetch(', at + 1)
    }
  }
  return out
}

describe('API inventory', () => {
  it('classifies every node route the client calls', () => {
    const inventory = fs.readFileSync(INVENTORY, 'utf8')
    const documented = new Set<string>()
    // The markdown wraps routes in backticks; the character is built from its
    // code point so the source itself stays free of template-literal syntax.
    const tick = String.fromCharCode(96)
    for (const line of inventory.split(/\r?\n/)) {
      if (!line.startsWith('|')) continue
      const start = line.indexOf(tick)
      if (start === -1) continue
      const end = line.indexOf(tick, start + 1)
      if (end === -1) continue
      const route = line.slice(start + 1, end)
      if (route.startsWith('/api/')) documented.add(normalizeRoute(route))
    }
    expect(documented.size).toBeGreaterThan(20)

    const used = collectRoutes(SRC)
    expect(used.size).toBeGreaterThan(20)

    // A documented pattern covers a route when it matches exactly or the
    // pattern's trailing '*' is a prefix of the route.
    const patterns = [...documented]
    const isDocumented = (route: string) => patterns.some((pattern) => {
      if (pattern === route) return true
      if (pattern.endsWith('*')) return route.startsWith(pattern.slice(0, -1))
      return false
    })

    const missing = [...used].filter((route) => !isDocumented(route)).sort()
    expect(missing).toEqual([])
  })
})
