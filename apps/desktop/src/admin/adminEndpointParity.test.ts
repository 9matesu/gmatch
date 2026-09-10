import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Static parity gate: every /api/admin path referenced by the client choke
 * point must exist as a registered route in the server file. This kills the
 * "phantom endpoint" class of bug (the pm unhide 404 shipped unnoticed for
 * months because URLs are stringly-typed).
 */
function norm(p: string): string[] {
  const clean = p.split('?')[0].replace(/\$\{[^}]*\}/g, ':x').replace(/:[A-Za-z0-9_]+/g, ':x');
  return clean.split('/').filter(Boolean);
}

function serverMatches(clientSegs: string[], route: string): boolean {
  const rs = norm(route);
  if (rs.length !== clientSegs.length) return false;
  return clientSegs.every((seg, i) => seg === rs[i] || rs[i] === ':x' || seg === ':x');
}

describe('admin endpoint parity (client -> server)', () => {
  const client = readFileSync(resolve(__dirname, '../utils/adminApi.ts'), 'utf8');
  const server = readFileSync(resolve(__dirname, '../../../api/src/routes/admin.ts'), 'utf8');

  const routes = [...server.matchAll(/^admin\.(get|post|patch|put|delete)\('([^']+)'/gm)].map((m) => m[2]);
  const paths = [...client.matchAll(/\$\{ADMIN_BASE\}([^'"`\s]*)/g)].map((m) => m[1]).filter(Boolean);
  const unique = [...new Set(paths.map((p) => norm(p).join('/')))];

  it('server file exposes routes', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it.each(unique)('client path /%s has a registered server route', (joined) => {
    const segs = joined.split('/');
    expect(routes.some((r) => serverMatches(segs, r))).toBe(true);
  });

  it('no removed privacy-surveillance endpoints resurface', () => {
    for (const banned of ['private-messages', 'traffic-sources', 'stats/referrer']) {
      expect(client).not.toContain(banned);
    }
    expect(client).not.toMatch(/\/chat[^/]*'?\s*\?[^)]*channel=dm/);
  });
});
