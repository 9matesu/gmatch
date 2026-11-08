import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Static parity gate: every /api/admin request the client makes must exist
 * as a registered route in the server file — WITH THE SAME VERB.
 *
 * This kills the "phantom endpoint" class of bug (the pm unhide 404 shipped
 * unnoticed for months because URLs are stringly-typed).
 *
 * The verb used to be captured by the regex and then THROWN AWAY, so the gate
 * only checked paths. A verb mismatch shipped anyway: the client PUT
 * `/users/:id/moderator` while the server registered it as POST, and the
 * moderator grant 404'd in production. The gate now compares (VERB, PATH).
 */
type Verb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function norm(p: string): string[] {
  const clean = p.split('?')[0].replace(/\$\{[^}]*\}/g, ':x').replace(/:[A-Za-z0-9_]+/g, ':x');
  return clean.split('/').filter(Boolean);
}

function serverMatches(clientSegs: string[], route: string): boolean {
  const rs = norm(route);
  if (rs.length !== clientSegs.length) return false;
  return clientSegs.every((seg, i) => seg === rs[i] || rs[i] === ':x' || seg === ':x');
}

/**
 * Client request → (verb, path).
 *
 * The path lives in a template literal and the verb in the options object a
 * few characters later, so the scan cannot cross a backtick (that would let
 * one call inherit the next call's verb). A call with no explicit method is a
 * GET — `orbitFetch` defaults to it.
 */
function clientCalls(source: string): Array<{ verb: Verb; path: string }> {
  const explicit: Array<{ verb: Verb; path: string }> = [];
  const withMethod = /\$\{ADMIN_BASE\}([^'"`]*)[`'"][^`]*?method:\s*"(GET|POST|PUT|PATCH|DELETE)"/g;
  for (const m of source.matchAll(withMethod)) {
    explicit.push({ verb: m[2] as Verb, path: m[1] });
  }

  const verbsByPath = new Map<string, Set<Verb>>();
  const key = (p: string) => norm(p).join('/');
  for (const c of explicit) {
    const k = key(c.path);
    const set = verbsByPath.get(k) ?? new Set<Verb>();
    set.add(c.verb);
    verbsByPath.set(k, set);
  }

  // Every path the client mentions. A path with no explicit verb is a GET.
  const bare = /\$\{ADMIN_BASE\}([^'"`\s]*)/g;
  const out: Array<{ verb: Verb; path: string }> = [];
  for (const m of source.matchAll(bare)) {
    const k = key(m[1]);
    const verbs = verbsByPath.get(k);
    if (!verbs) {
      verbsByPath.set(k, new Set<Verb>(['GET']));
      out.push({ verb: 'GET', path: m[1] });
    } else {
      for (const v of verbs) out.push({ verb: v, path: m[1] });
    }
  }
  return out;
}

/** Direct `orbitFetch("/api/admin/...", { method })` calls outside adminApi. */
function directCalls(source: string): Array<{ verb: Verb; path: string }> {
  const out: Array<{ verb: Verb; path: string }> = [];
  const re = /orbitFetch\(\s*[`"'](\/api\/admin[^"'`]*)[`'"]\s*,\s*\{([^}]*)\}/g;
  for (const m of source.matchAll(re)) {
    const verb = /method:\s*"(GET|POST|PUT|PATCH|DELETE)"/.exec(m[2])?.[1] ?? 'GET';
    // The server registers admin routes RELATIVE to the /api/admin mount.
    out.push({ verb: verb as Verb, path: m[1].replace(/^\/api\/admin/, '') });
  }
  return out;
}

describe('admin endpoint parity (client -> server)', () => {
  const client = readFileSync(resolve(__dirname, '../utils/adminApi.ts'), 'utf8');
  const adminApp = readFileSync(resolve(__dirname, 'AdminApp.tsx'), 'utf8');
  const server = readFileSync(resolve(__dirname, '../../../api/src/routes/admin.ts'), 'utf8');

  const routes = [...server.matchAll(/^admin\.(get|post|patch|put|delete)\('([^']+)'/gm)].map((m) => ({
    verb: m[1].toUpperCase() as Verb,
    path: m[2],
  }));
  const calls = [...clientCalls(client), ...directCalls(adminApp)];
  const unique = [
    ...new Map(calls.map((c) => [`${c.verb} ${norm(c.path).join('/')}`, { ...c, title: `${c.verb} /${norm(c.path).join('/')}` }])).values(),
  ];

  it('server file exposes routes', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it.each(unique)('client $title has a registered server route with the same verb', (c) => {
    const segs = norm(c.path);
    const matching = routes.filter((r) => serverMatches(segs, r.path));
    expect(matching.length).toBeGreaterThan(0);
    // The path exists — now the VERB has to exist too.
    expect(matching.map((r) => r.verb)).toContain(c.verb);
  });

  it('no removed privacy-surveillance endpoints resurface', () => {
    for (const banned of ['private-messages', 'traffic-sources', 'stats/referrer']) {
      expect(client).not.toContain(banned);
    }
    expect(client).not.toMatch(/\/chat[^/]*'?\s*\?[^)]*channel=dm/);
    // denunciation protocol: no bulk per-user asset sweep from the panel
    expect(client).not.toMatch(/users\/\$\{[^}]+\}\/objects/);
  });
});
