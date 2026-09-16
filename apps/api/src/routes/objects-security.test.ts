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

  it('GAP-A: an admin CANNOT read a private object without a case (denunciation protocol)', async () => {
    const path = `/api/objects/${testObjectId}`;
    const headers = signRequestHeaders(admin, 'GET', path);
    const res = await app.request(path, { method: 'GET', headers });
    expect(res.status).toBe(404);
  });

  it('GAP-A: allows direct media streaming via valid signed HMAC token URL without headers', async () => {
    const { sig, exp, jti } = createSignedObjectToken(testObjectId, 900);
    const res = await app.request(`/api/objects/${testObjectId}?sig=${sig}&exp=${exp}&jti=${jti}`, {
      method: 'GET',
    });
    expect(res.status).toBe(200);
  });

  it('GAP-A: rejects tampered, expired or jti-less HMAC tokens without headers', async () => {
    const { sig, exp, jti } = createSignedObjectToken(testObjectId, 900);
    // Tampered signature
    const resBadSig = await app.request(`/api/objects/${testObjectId}?sig=bad${sig.slice(3)}&exp=${exp}&jti=${jti}`, {
      method: 'GET',
    });
    expect(resBadSig.status).toBe(401);

    // Expired token (fresh jti so only expiry can fail it)
    const e2 = createSignedObjectToken(testObjectId, 900)
    const resExpired = await app.request(`/api/objects/${testObjectId}?sig=${e2.sig}&exp=${Math.floor(Date.now() / 1000) - 10}&jti=${e2.jti}`, {
      method: 'GET',
    });
    expect(resExpired.status).toBe(401);

    // B.7: legacy-style URL without jti is dead
    const legacy = createSignedObjectToken(testObjectId, 900)
    const resNoJti = await app.request(`/api/objects/${testObjectId}?sig=${legacy.sig}&exp=${legacy.exp}`, {
      method: 'GET',
    });
    expect(resNoJti.status).toBe(401);
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

  it('POST /:id/view records a StoryView and is idempotent', async () => {
    const storyId = 'view-story-' + Date.now();
    await env.DB.prepare(`
      INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_story)
      VALUES (?, ?, 100, 'image/jpeg', 'data:image/jpeg;base64,dGVzdA==', 1)
    `).bind(storyId, owner.orbitId).run();

    const path = `/api/objects/${storyId}/view`;
    const headers = signRequestHeaders(stranger, 'POST', path);
    expect((await app.request(path, { method: 'POST', headers })).status).toBe(200);
    expect((await app.request(path, { method: 'POST', headers })).status).toBe(200);

    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM StoryViews WHERE object_id = ? AND viewer_id = ?')
      .bind(storyId, stranger.orbitId).first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it('POST /:id/view rejects a non-story object with 404', async () => {
    const path = `/api/objects/${testObjectId}/view`;
    const headers = signRequestHeaders(owner, 'POST', path);
    expect((await app.request(path, { method: 'POST', headers })).status).toBe(404);
  });

  it('GET /stories flags viewed stories for the requesting viewer only', async () => {
    const storyId = 'flag-story-' + Date.now();
    await env.DB.prepare(`
      INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_story)
      VALUES (?, ?, 100, 'image/jpeg', 'data:image/jpeg;base64,dGVzdA==', 1)
    `).bind(storyId, owner.orbitId).run();

    await app.request(`/api/objects/${storyId}/view`, {
      method: 'POST',
      headers: signRequestHeaders(owner, 'POST', `/api/objects/${storyId}/view`),
    });

    const asViewer = await app.request('/api/objects/stories', {
      headers: signRequestHeaders(owner, 'GET', '/api/objects/stories'),
    });
    const viewerList = await asViewer.json() as any[];
    expect(viewerList.find((s) => s.id === storyId)?.viewed).toBe(1);

    const asStranger = await app.request('/api/objects/stories', {
      headers: signRequestHeaders(stranger, 'GET', '/api/objects/stories'),
    });
    const strangerList = await asStranger.json() as any[];
    expect(strangerList.find((s) => s.id === storyId)?.viewed).toBe(0);
  });
});
