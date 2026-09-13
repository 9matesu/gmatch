// Avatar-by-object-ref: the client uploads bytes as multipart (sealed JSON
// with a data: URL trips the edge header limit -> 403/431), patches the tiny
// /api/objects/<id> ref, and the PUBLIC GET /:id/pfp streams the decrypted
// blob so plain <img> tags render. Range works on the inline-data branch too.
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { users } from './users';
import { objects } from './objects';
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function build() {
  const env = await createMockEnv();
  const app = new Hono();
  app.use('*', async (c, next) => { c.env = env; return next(); });
  app.route('/api/users', users);
  app.route('/api/objects', objects);
  const owner = createTestIdentity();
  await env.DB.prepare('INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, ?)')
    .bind(owner.orbitId, owner.publicKeyHex, 'Avatar Owner', new Date().toISOString()).run();
  return { env, app, owner };
}

function pngForm() {
  const form = new FormData();
  form.append('image', new File([Buffer.from(PNG_B64, 'base64')], 'a.png', { type: 'image/png' }));
  return form;
}

describe('avatar object ref (pfp 403 fix)', () => {
  it('PATCH profile accepts an owned /api/objects ref and /:id/pfp serves the bytes anonymously', async () => {
    const { app, owner } = await build();
    const upRes = await app.request('/api/objects', {
      method: 'POST', body: pngForm(),
      headers: signRequestHeaders(owner, 'POST', '/api/objects'),
    });
    expect(upRes.status).toBe(201);
    const { id } = await upRes.json() as { id: string };

    const body = JSON.stringify({ pfp_url: `/api/objects/${id}` });
    const patchRes = await app.request('/api/users/profile', {
      method: 'PATCH', body,
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(owner, 'PATCH', '/api/users/profile', body) },
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).pfp_url).toBe(`/api/objects/${id}`);

    // Anonymous public pfp render (plain <img> path, no auth headers at all)
    const pfp = await app.request(`/api/users/${owner.orbitId}/pfp`);
    expect(pfp.status).toBe(200);
    expect(pfp.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await pfp.arrayBuffer()).equals(Buffer.from(PNG_B64, 'base64'))).toBe(true);
  });

  it('rejects a ref to a non-existent object', async () => {
    const { app, owner } = await build();
    const body = JSON.stringify({ pfp_url: '/api/objects/00000000-0000-4000-8000-000000000000' });
    const res = await app.request('/api/users/profile', {
      method: 'PATCH', body,
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(owner, 'PATCH', '/api/users/profile', body) },
    });
    expect(res.status).toBe(404);
  });

  it('a stranger cannot claim someone else\'s object as their avatar', async () => {
    const { env, app, owner } = await build();
    const upRes = await app.request('/api/objects', {
      method: 'POST', body: pngForm(),
      headers: signRequestHeaders(owner, 'POST', '/api/objects'),
    });
    const { id } = await upRes.json() as { id: string };
    const thief = createTestIdentity();
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, ?)')
      .bind(thief.orbitId, thief.publicKeyHex, 'Thief', new Date().toISOString()).run();
    const body = JSON.stringify({ pfp_url: `/api/objects/${id}` });
    const res = await app.request('/api/users/profile', {
      method: 'PATCH', body,
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(thief, 'PATCH', '/api/users/profile', body) },
    });
    expect(res.status).toBe(404);
  });

  it('inline objects answer 206 with correct slices for Range requests', async () => {
    const { app, owner } = await build();
    const upRes = await app.request('/api/objects', {
      method: 'POST', body: pngForm(),
      headers: signRequestHeaders(owner, 'POST', '/api/objects'),
    });
    const { id } = await upRes.json() as { id: string };
    const rng = await app.request(`/api/objects/${id}`, {
      headers: { ...signRequestHeaders(owner, 'GET', `/api/objects/${id}`), Range: 'bytes=2-5' },
    });
    expect(rng.status).toBe(206);
    expect(rng.headers.get('content-range')).toMatch(/^bytes 2-5\/\d+$/);
    expect(Buffer.from(await rng.arrayBuffer()).length).toBe(4);
  });
});
