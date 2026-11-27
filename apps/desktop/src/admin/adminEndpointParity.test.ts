import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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

/** The text of the call's argument list: from `from` to the parenthesis that
 * closes the call. A nested call's own parens are balanced out, so the scan
 * never runs past the call it started in. */
function callArgs(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) return source.slice(from, i);
      depth--;
    }
  }
  return source.slice(from);
}

/** The verb of the call whose arguments start at `from`. A call with no
 * explicit method is a GET — `orbitFetch` defaults to it. */
function verbOfCall(source: string, from: number): Verb {
  const args = callArgs(source, from);
  const m = /method:\s*"(GET|POST|PUT|PATCH|DELETE)"/.exec(args);
  return (m?.[1] ?? 'GET') as Verb;
}

/** The name of the function the literal at `at` is an argument of — used to
 * tell a real request apart from a string comparison (`url.includes(...)`). */
function calleeName(source: string, at: number): string {
  let i = at - 1;
  while (i >= 0 && /\s/.test(source[i])) i--;
  if (source[i] !== '(') return '';
  const end = i;
  let j = i - 1;
  while (j >= 0 && /[A-Za-z0-9_$]/.test(source[j])) j--;
  return source.slice(j + 1, end);
}

const HTTP_CALLERS = new Set(['orbitFetch', 'fetchJson', 'fetchArray', 'fetchTable', 'fetch']);

/**
 * Client request → (verb, path).
 *
 * The path lives in a template literal and the verb in the options object a
 * few characters later, so the verb is read from the ENCLOSING call — not
 * from a regex that could bleed into the next call.
 */
function clientCalls(source: string): Array<{ verb: Verb; path: string }> {
  const out: Array<{ verb: Verb; path: string }> = [];
  const re = /\$\{ADMIN_BASE\}([^'"`]*)[`'"]/g;
  for (const m of source.matchAll(re)) {
    const end = m.index + m[0].length;
    out.push({ verb: verbOfCall(source, end), path: m[1] });
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

/**
 * REVERSE parity: server route -> client caller.
 *
 * The forward gate kills phantom endpoints (the client asks for a route that
 * does not exist). This one kills the opposite rot: a route that exists on
 * the server and NOTHING in the product ever calls. Those endpoints are not
 * features — they are code that survives review, drifts from the UI, and
 * widens the admin attack surface for nothing. The bot admin surface, the
 * duplicated object delete/redact pair and the unread "live users" table all
 * lived there until this gate existed.
 *
 * An exception must be listed WITH A REASON. The list is checked for
 * staleness, so a route that gets wired up cannot sit in it forever.
 */
const UNCALLED_OK: Array<{ verb: Verb; path: string; why: string }> = [
  // (none — every admin route is reachable from the admin UI today)
];

/**
 * Admin routes that are PUBLIC BY DESIGN: registered ABOVE the adminAuth
 * guard, so they answer without a PIN.
 *
 * `/verify-pin` cannot require the PIN it verifies, so it is the one legal
 * exception. The gate proves the claim structurally — the route must really
 * sit above `admin.use('*', adminAuth)` — and proves the converse, that
 * nothing ELSE escaped the guard.
 */
const PUBLIC_BY_DESIGN: Array<{ verb: Verb; path: string; why: string }> = [
  { verb: 'POST', path: '/verify-pin', why: 'It IS the PIN gate — it cannot require the PIN it verifies.' },
];

/** Every desktop source file, tests EXCLUDED: a route only a test calls is
 * dead in the product. */
function productSources(dir: string): Array<{ file: string; source: string }> {
  const out: Array<{ file: string; source: string }> = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = resolve(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
      out.push({ file: full, source: readFileSync(full, 'utf8') });
    }
  };
  walk(dir);
  return out;
}

/** Every `/api/admin/...` request the desktop makes, from ANY source file. */
function adminCallsIn(source: string): Array<{ verb: Verb; path: string }> {
  const out: Array<{ verb: Verb; path: string }> = [];
  const re = /['"`]([^'"`]*\/api\/admin\/[^'"`]*)['"`]/g;
  for (const m of source.matchAll(re)) {
    if (!HTTP_CALLERS.has(calleeName(source, m.index))) continue;
    const path = m[1].replace(/^.*\/api\/admin/, '');
    out.push({ verb: verbOfCall(source, m.index + m[0].length), path });
  }
  return out;
}

describe('admin endpoint parity (server -> client)', () => {
  const srcRoot = resolve(__dirname, '..');
  const adminApiSource = readFileSync(resolve(srcRoot, 'utils/adminApi.ts'), 'utf8');
  const server = readFileSync(resolve(__dirname, '../../../api/src/routes/admin.ts'), 'utf8');

  const routes = [...server.matchAll(/^admin\.(get|post|patch|put|delete)\('([^']+)'/gm)].map((m) => ({
    verb: m[1].toUpperCase() as Verb,
    path: m[2],
  }));

  // adminApi.ts talks in `${ADMIN_BASE}/...`; every other file spells the
  // mount out as `/api/admin/...`.
  const calls = [
    ...clientCalls(adminApiSource),
    ...productSources(srcRoot)
      .filter((f) => !f.file.endsWith('adminApi.ts'))
      .flatMap((f) => adminCallsIn(f.source)),
  ];

  const allow = (r: { verb: Verb; path: string }) =>
    UNCALLED_OK.some((a) => a.verb === r.verb && norm(a.path).join('/') === norm(r.path).join('/'));

  const uncalled = routes.filter((r) => !calls.some((c) => c.verb === r.verb && serverMatches(norm(c.path), r.path)));

  it('every server admin route is called by the client', () => {
    const dead = uncalled.filter((r) => !allow(r));
    expect(
      dead.map((r) => `${r.verb} ${r.path}`),
      'server admin routes with no client caller — wire them up or delete them',
    ).toEqual([]);
  });

  it('the uncalled allowlist has no stale entries', () => {
    for (const entry of UNCALLED_OK) {
      expect(entry.why.trim().length).toBeGreaterThan(0);
      const nowCalled = calls.some((c) => c.verb === entry.verb && serverMatches(norm(c.path), entry.path));
      expect(nowCalled, `${entry.verb} ${entry.path} is called now — drop it from the allowlist`).toBe(false);
    }
  });

  it('only the declared public-by-design routes escape the admin guard', () => {
    const guardAt = server.indexOf("admin.use('*', adminAuth)");
    expect(guardAt, 'the admin guard must exist').toBeGreaterThan(-1);
    const routeMatches = [...server.matchAll(/^admin\.(get|post|patch|put|delete)\('([^']+)'/gm)];
    const publicRoutes = routeMatches
      .filter((m) => m.index < guardAt)
      .map((m) => ({ verb: m[1].toUpperCase() as Verb, path: m[2] }));

    const declared = PUBLIC_BY_DESIGN.map((p) => `${p.verb} ${p.path}`).sort();
    expect(publicRoutes.map((r) => `${r.verb} ${r.path}`).sort(), 'a new admin route escaped the PIN guard').toEqual(declared);
    for (const entry of PUBLIC_BY_DESIGN) {
      expect(entry.why.trim().length).toBeGreaterThan(0);
    }
  });
});

/** The top-level keys of the `adminApi` object literal (the helpers above it
 * are not part of the surface). */
function adminApiKeys(source: string): string[] {
  const start = source.indexOf('export const adminApi = {');
  if (start < 0) return [];
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = source.length;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const keys: string[] = [];
  for (const line of source.slice(open + 1, end).split('\n')) {
    const m = /^ {2}([a-zA-Z][a-zA-Z0-9]*):/.exec(line);
    if (m) keys.push(m[1]);
  }
  return keys;
}

describe('adminApi surface (every wrapper is used)', () => {
  const srcRoot = resolve(__dirname, '..');
  const adminApiSource = readFileSync(resolve(srcRoot, 'utils/adminApi.ts'), 'utf8');
  const keys = adminApiKeys(adminApiSource);

  const users = productSources(srcRoot)
    .filter((f) => !f.file.endsWith('adminApi.ts'))
    .map((f) => f.source)
    .join('\n');

  it('has a non-trivial surface', () => {
    expect(keys.length).toBeGreaterThan(40);
  });

  it('every adminApi wrapper is called by the product', () => {
    const unused = keys.filter((k) => !new RegExp(`\\badminApi\\.${k}\\b`).test(users));
    expect(unused, 'adminApi wrappers nothing calls — delete them').toEqual([]);
  });
});
