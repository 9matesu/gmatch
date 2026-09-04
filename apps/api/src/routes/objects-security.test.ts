import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { objects } from './objects';
import { createSignedObjectToken } from '../crypto';
import { createMockEnv, createTestIdentity, signRequestHeaders, type TestIdentity } from '../test-utils';

describe('Objects API — Security & Access Control (GAPs A/B)', () => {
  let app: Hono<any>;
  let env: any;
  let owner: TestIdentity;
  let stranger: TestIdentity;
  let admin: TestIdentity;
  let testObjectId: string;

  beforeEach(async () => {
    env = await createMockEnv();
    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = env;
      return next();
    });
    app.route('/api/objects', objects);

    owner = createTestIdentity();
    stranger = createTestIdentity();
    admin = createTestIdentity();

    // Register test users in DB
    await env.DB.prepare('INSERT INTO Users (id, public_key, is_admin) VALUES (?, ?, 0)')
      .bind(owner.orbitId, owner.publicKeyHex)
      .run();
    await env.DB.prepare('INSERT INTO Users (id, public_key, is_admin) VALUES (?, ?, 0)')
      .bind(stranger.orbitId, stranger.publicKeyHex)
      .run();
    await env.DB.prepare('INSERT INTO Users (id, public_key, is_admin) VALUES (?, ?, 1)')
      .bind(admin.orbitId, admin.publicKeyHex)
      .run();

    // Insert a test private object owned by owner
    testObjectId = 'test-obj-' + Date.now();
    await env.DB.prepare(`
      INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_story)
      VALUES (?, ?, 100, 'image/jpeg', 'data:image/jpeg;base64,dGVzdA==', 0)
    `).bind(testObjectId, owner.orbitId).run();
  });

  it('GAP-A: rejects unauthenticated requests to GET /api/objects/:id for private objects with 404', async () => {
    const res = await app.request(`/api/objects/${testObjectId}`, { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('allows reading public objects without auth headers', async () => {
    const publicObjectId = 'public-obj-' + Date.now();
    await env.DB.prepare(`
      INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_story)
      VALUES (?, ?, 100, 'image/jpeg', 'data:image/jpeg;base64,dGVzdA==', 1, 0)
    `).bind(publicObjectId, owner.orbitId).run();

    const res = await app.request(`/api/objects/${publicObjectId}`, { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('allows reading active Cards without auth headers', async () => {
    const cardObjectId = 'card-obj-' + Date.now();
    await env.DB.prepare(`
      INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_story)
      VALUES (?, ?, 100, 'image/jpeg', 'data:image/jpeg;base64,dGVzdA==', 0, 0)
    `).bind(cardObjectId, owner.orbitId).run();

    await env.DB.prepare(`
      INSERT INTO Cards (id, creator_id, media_object_id, name, rarity, moderation_state)
      VALUES (?, ?, ?, 'Test Card', 'common', 'active')
    `).bind('card-id-' + Date.now(), owner.orbitId, cardObjectId).run();

    const res = await app.request(`/api/objects/${cardObjectId}`, { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('GAP-A: rejects unauthorized stranger requests with 404 (preventing ID enumeration)', async () => {
    const path = `/api/objects/${testObjectId}`;
    const headers = signRequestHeaders(stranger, 'GET', path);
    const res = await app.request(path, { method: 'GET', headers });
    expect(res.status).toBe(404);
  });

  it('GAP-A: allows object owner to read the object data', async () => {
    const path = `/api/objects/${testObjectId}`;
    const headers = signRequestHeaders(owner, 'GET', path);
    const res = await app.request(path, { method: 'GET', headers });
    expect(res.status).toBe(200);
  });

  it('GAP-A: allows admin to read any object', async () => {
    const path = `/api/objects/${testObjectId}`;
    const headers = signRequestHeaders(admin, 'GET', path);
    const res = await app.request(path, { method: 'GET', headers });
    expect(res.status).toBe(200);
  });

  it('GAP-A: allows direct media streaming via valid signed HMAC token URL without headers', async () => {
    const { sig, exp } = createSignedObjectToken(testObjectId, 3600);
    const res = await app.request(`/api/objects/${testObjectId}?sig=${sig}&exp=${exp}`, {
      method: 'GET',
    });
    expect(res.status).toBe(200);
  });

  it('GAP-A: rejects tampered or expired HMAC tokens without headers', async () => {
    const { sig } = createSignedObjectToken(testObjectId, 3600);
    // Tampered signature
    const resBadSig = await app.request(`/api/objects/${testObjectId}?sig=bad${sig.slice(3)}&exp=${Math.floor(Date.now() / 1000) + 3600}`, {
      method: 'GET',
    });
    expect(resBadSig.status).toBe(401);

    // Expired token
    const resExpired = await app.request(`/api/objects/${testObjectId}?sig=${sig}&exp=${Math.floor(Date.now() / 1000) - 10}`, {
      method: 'GET',
    });
    expect(resExpired.status).toBe(401);
  });

  it('GAP-B: rejects unauthenticated requests to GET /api/objects/stories with 401', async () => {
    const res = await app.request('/api/objects/stories', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('GAP-B: allows authenticated user to fetch the stories feed', async () => {
    const path = '/api/objects/stories';
    const headers = signRequestHeaders(owner, 'GET', path);
    const res = await app.request(path, { method: 'GET', headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});
