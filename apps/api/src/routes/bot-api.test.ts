import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { getBotConfig, saveBotConfig, extractImageUrlsFromJson, pickSlideshowSearchTags, getBotProfiles, saveBotProfile, deleteBotProfile, buildApiRequestUrl } from '../bot-image-api'

const adminId = createTestIdentity()
const regularId = createTestIdentity()

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

describe('Bot & External Image API Integration', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()

    // Register users
    await app.request('/api/users', { headers: authHeaders(adminId, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(regularId, 'GET', '/api/users') }, env)

    // Make adminId an admin
    await env.DB.prepare('UPDATE Users SET is_admin = 1 WHERE id = ?').bind(adminId.orbitId).run()

    // Seed an admin-managed duelist so the roster endpoints have content (bots
    // now come only from the Bots table — no dynamic/hardcoded fallback).
    await saveBotProfile(env.DB, {
      id: 'bot_seeded',
      name: 'Seeded Duelist',
      tags: ['1girl', 'solo'],
      enabled: true,
    })
  })

  it('reads and saves bot config via SystemMeta', async () => {
    const initial = await getBotConfig(env.DB)
    expect(initial.apiUrl).toBeDefined()
    expect(initial.names).toEqual([])

    await saveBotConfig(env.DB, {
      apiUrl: 'https://api.example.com/images',
      apiKey: 'secret-token-123',
      tags: ['cyberpunk', 'synthwave'],
      names: ['Nova', 'Valkyrie', 'Eclipse'],
      enabled: true,
    })

    const updated = await getBotConfig(env.DB)
    expect(updated.apiUrl).toBe('https://api.example.com/images')
    expect(updated.apiKey).toBe('secret-token-123')
    expect(updated.tags).toEqual(['cyberpunk', 'synthwave'])
    expect(updated.names).toEqual(['Nova', 'Valkyrie', 'Eclipse'])
  })

  it('extracts image URLs from diverse JSON schemas', () => {
    // Array of objects (Danbooru style)
    const booruData = [
      { file_url: 'https://cdn.example.com/img1.jpg', tag_string: '1girl cyberpunk neon' },
      { url: 'https://cdn.example.com/img2.png', caption: 'Cyber Warrior' },
    ]
    const extracted1 = extractImageUrlsFromJson(booruData)
    expect(extracted1.length).toBe(2)
    expect(extracted1[0].url).toBe('https://cdn.example.com/img1.jpg')
    expect(extracted1[0].tags).toContain('cyberpunk')

    // Waifu.im nested schema
    const waifuData = {
      images: [
        { url: 'https://cdn.waifu.im/w1.jpg', tags: [{ name: 'waifu' }, { name: 'maid' }] },
      ],
    }
    const extracted2 = extractImageUrlsFromJson(waifuData)
    expect(extracted2.length).toBe(1)
    expect(extracted2[0].url).toBe('https://cdn.waifu.im/w1.jpg')
    expect(extracted2[0].tags).toContain('waifu')

    // Nekos.best schema
    const nekosData = {
      results: [
        { url: 'https://nekos.best/api/v2/neko/001.png', artist_name: 'Artist 1' },
      ],
    }
    const extracted3 = extractImageUrlsFromJson(nekosData)
    expect(extracted3.length).toBe(1)
    expect(extracted3[0].url).toBe('https://nekos.best/api/v2/neko/001.png')
    expect(extracted3[0].caption).toBe('Artist 1')

    // Gelbooru schema: @attributes + singular "post" array with space-separated tags and file_url
    const gelbooruData = {
      '@attributes': { limit: 100, offset: 0, count: 14038734 },
      post: [
        {
          id: 14697459,
          file_url: 'https://img4.gelbooru.com/images/a5/13/a51399eb86d111697996d3eda1185184.png',
          preview_url: 'https://img4.gelbooru.com/thumbnails/a5/13/thumbnail_a51399eb86d111697996d3eda1185184.jpg',
          tags: '1girl swimsuit fate_grand_order',
        },
      ],
    }
    const extracted4 = extractImageUrlsFromJson(gelbooruData)
    expect(extracted4.length).toBe(1)
    expect(extracted4[0].url).toBe('https://img4.gelbooru.com/images/a5/13/a51399eb86d111697996d3eda1185184.png')
    expect(extracted4[0].tags).toContain('swimsuit')
  })

  it('GET /api/admin/bot-config requires admin authentication', async () => {
    const forbidden = await app.request('/api/admin/bot-config', {
      method: 'GET',
      headers: authHeaders(regularId, 'GET', '/api/admin/bot-config'),
    }, env)
    expect(forbidden.status).toBe(403)

    const allowed = await app.request('/api/admin/bot-config', {
      method: 'GET',
      headers: authHeaders(adminId, 'GET', '/api/admin/bot-config'),
    }, env)
    expect(allowed.status).toBe(200)
    const body = await allowed.json()
    expect(body.apiUrl).toBeDefined()
    expect(body.names).toBeDefined()
  })

  it('PUT /api/admin/bot-config updates settings and logs action', async () => {
    const payload = JSON.stringify({
      apiUrl: 'https://danbooru.donmai.us/posts.json',
      apiKey: 'test-key',
      tags: ['scenery', 'night'],
      names: ['Sol', 'Nyx'],
      enabled: true,
    })

    const res = await app.request('/api/admin/bot-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'PUT', '/api/admin/bot-config', payload),
      },
      body: payload,
    }, env)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.config.apiUrl).toBe('https://danbooru.donmai.us/posts.json')
    expect(body.config.names).toEqual(['Sol', 'Nyx'])
  })

  it('POST /api/admin/bot-config/test executes diagnostics', async () => {
    const payload = JSON.stringify({
      apiUrl: 'https://invalid-non-existent-api-url.xyz/test',
      tags: ['test'],
    })

    const res = await app.request('/api/admin/bot-config/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/bot-config/test', payload),
      },
      body: payload,
    }, env)

    expect(res.status).toBe(200)
    const result = await res.json()
    expect(result.ok).toBe(false)
    expect(result.logs.length).toBeGreaterThan(0)
    expect(result.error).toBeDefined()
  })

  it('handles Gelbooru count: 0 response without crashing', () => {
    const gelbooruEmpty = {
      "@attributes": { limit: 100, offset: 0, count: 0 }
    }
    const extracted = extractImageUrlsFromJson(gelbooruEmpty)
    expect(extracted.length).toBe(0)
  })

  it('PUT /api/admin/bot-config persists activation rule, fallback seconds, and models', async () => {
    const payload = JSON.stringify({
      providers: [
        {
          id: 'prov_act_1',
          name: 'Activation Pool',
          providerType: 'waifu_im',
          url: 'https://api.waifu.im/search',
          tags: ['waifu'],
          enabled: true,
        },
      ],
      names: ['Sol'],
      enabled: true,
      activationRule: 'manual_only',
      fallbackSeconds: 45,
      models: ['anime_v1', 'cyber_v2'],
    })

    const res = await app.request('/api/admin/bot-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'PUT', '/api/admin/bot-config', payload),
      },
      body: payload,
    }, env)
    expect(res.status).toBe(200)

    const saved = await res.json()
    expect(saved.config.activationRule).toBe('manual_only')
    expect(saved.config.fallbackSeconds).toBe(45)
    expect(saved.config.models).toEqual(['anime_v1', 'cyber_v2'])

    const getRes = await app.request('/api/admin/bot-config', {
      method: 'GET',
      headers: authHeaders(adminId, 'GET', '/api/admin/bot-config'),
    }, env)
    const fetched = await getRes.json()
    expect(fetched.activationRule).toBe('manual_only')
    expect(fetched.fallbackSeconds).toBe(45)
    expect(fetched.models).toEqual(['anime_v1', 'cyber_v2'])
  })

  it('rejects an invalid activation rule', async () => {
    const payload = JSON.stringify({ enabled: true, activationRule: 'bogus' })
    const res = await app.request('/api/admin/bot-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'PUT', '/api/admin/bot-config', payload),
      },
      body: payload,
    }, env)
    expect(res.status).toBe(400)
  })

  it('rejects providers pointing at private/internal hosts', async () => {
    const payload = JSON.stringify({
      providers: [
        {
          id: 'prov_bad',
          name: 'Bad Host',
          providerType: 'generic',
          url: 'http://169.254.169.254/latest/meta-data',
          enabled: true,
        },
      ],
      enabled: true,
    })
    const res = await app.request('/api/admin/bot-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'PUT', '/api/admin/bot-config', payload),
      },
      body: payload,
    }, env)
    expect(res.status).toBe(400)
  })

  it('preserves intentionally empty global tags on GET', async () => {
    await saveBotConfig(env.DB, { providers: [{ id: 'p_e', name: 'Empty', providerType: 'waifu_im', url: 'https://api.waifu.im/search', tags: ['waifu'], enabled: true }], tags: [], names: ['Aria'], enabled: true })
    const config = await getBotConfig(env.DB)
    expect(config.tags).toEqual([])
  })

  it('supports multi-API providers pool configuration and persistence', async () => {
    const payload = JSON.stringify({
      providers: [
        {
          id: 'prov_gelbooru_test',
          name: 'My Gelbooru',
          providerType: 'gelbooru',
          url: 'https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1',
          apiKey: 'test_api_key_123',
          userId: 'user_999',
          tags: ['1girl', 'cyberpunk'],
          enabled: true,
          weight: 10,
        },
        {
          id: 'prov_waifu_test',
          name: 'Waifu Pool',
          providerType: 'waifu_im',
          url: 'https://api.waifu.im/search',
          tags: ['waifu'],
          enabled: true,
          weight: 5,
        },
      ],
      names: ['Aria', 'Kestrel'],
      enabled: true,
    })

    const res = await app.request('/api/admin/bot-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'PUT', '/api/admin/bot-config', payload),
      },
      body: payload,
    }, env)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.config.providers.length).toBe(2)
    expect(data.config.providers[0].apiKey).toBe('test_api_key_123')
    expect(data.config.providers[0].userId).toBe('user_999')
    expect(data.config.providers[0].tags).toEqual(['1girl', 'cyberpunk'])
  })

  it('persists global search tags even when providers are also saved (admin panel flow)', async () => {
    await saveBotConfig(env.DB, {
      providers: [
        {
          id: 'prov_test_1',
          name: 'Pool One',
          providerType: 'gelbooru',
          url: 'https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1',
          tags: ['1girl', 'solo'],
          enabled: true,
        },
      ],
      tags: ['cyberpunk', 'synthwave', 'neon'],
      names: ['Aria'],
      enabled: true,
    })

    const config = await getBotConfig(env.DB)
    // Global tags must survive a save that also writes the provider pool.
    expect(config.tags).toEqual(['cyberpunk', 'synthwave', 'neon'])
    // The provider's own pool is untouched.
    expect(config.providers[0].tags).toEqual(['1girl', 'solo'])

    // Saving providers alone (no explicit tags) falls back to provider pool.
    await saveBotConfig(env.DB, {
      providers: [
        {
          id: 'prov_test_2',
          name: 'Pool Two',
          providerType: 'waifu_im',
          url: 'https://api.waifu.im/search',
          tags: ['waifu', 'maid'],
          enabled: true,
        },
      ],
    })
    const fallback = await getBotConfig(env.DB)
    expect(fallback.tags).toEqual(['waifu', 'maid'])
  })

  it('PUT /api/admin/bot-config persists distinct global tags alongside providers', async () => {
    const payload = JSON.stringify({
      providers: [
        {
          id: 'prov_route_1',
          name: 'Route Pool',
          providerType: 'gelbooru',
          url: 'https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1',
          tags: ['1girl'],
          enabled: true,
        },
      ],
      tags: ['landscape', 'night', 'rain'],
      names: ['Sol'],
      enabled: true,
    })

    const res = await app.request('/api/admin/bot-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'PUT', '/api/admin/bot-config', payload),
      },
      body: payload,
    }, env)
    expect(res.status).toBe(200)
    const saved = await res.json()
    expect(saved.config.tags).toEqual(['landscape', 'night', 'rain'])
    expect(saved.config.providers[0].tags).toEqual(['1girl'])

    const getRes = await app.request('/api/admin/bot-config', {
      method: 'GET',
      headers: authHeaders(adminId, 'GET', '/api/admin/bot-config'),
    }, env)
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.tags).toEqual(['landscape', 'night', 'rain'])
  })

  it('pickSlideshowSearchTags prefers global bot tags, then provider tags, then fallback', () => {
    expect(pickSlideshowSearchTags(['cyberpunk', 'neon'], ['1girl'])).toEqual(['cyberpunk', 'neon'])
    expect(pickSlideshowSearchTags([], ['1girl', 'solo'])).toEqual(['1girl', 'solo'])
    expect(pickSlideshowSearchTags([], [])).toEqual(['futa', 'bbc', 'cum', 'veiny_cock', 'explicit'])
    expect(pickSlideshowSearchTags(['  neon  ', ''], ['1girl'])).toEqual(['neon'])
  })

  // ─── Persistent bot duelist profiles ───

  it('GET /api/admin/bots requires admin and returns seeded duelists', async () => {
    const forbidden = await app.request('/api/admin/bots', {
      method: 'GET',
      headers: authHeaders(regularId, 'GET', '/api/admin/bots'),
    }, env)
    expect(forbidden.status).toBe(403)

    const allowed = await app.request('/api/admin/bots', {
      method: 'GET',
      headers: authHeaders(adminId, 'GET', '/api/admin/bots'),
    }, env)
    expect(allowed.status).toBe(200)
    const body = await allowed.json()
    expect(Array.isArray(body.bots)).toBe(true)
    expect(body.bots.length).toBeGreaterThan(0)
    expect(body.bots[0].id).toMatch(/^bot_/)
    expect(body.bots[0].name).toBeDefined()
  })

  it('POST /api/admin/bots creates a persistent duelist and syncs its Users row', async () => {
    const payload = JSON.stringify({ id: 'testalpha', name: 'Test Bot Alpha', tags: 'neon, cyberpunk' })
    const res = await app.request('/api/admin/bots', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/bots', payload),
      },
      body: payload,
    }, env)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.bot.id).toBe('bot_testalpha')
    expect(body.bot.name).toBe('Test Bot Alpha')
    expect(body.bot.tags).toEqual(['neon', 'cyberpunk'])
    expect(body.bot.enabled).toBe(true)

    // Persisted to the Bots table and the Users row is synced for roster visibility.
    const persisted = await getBotProfiles(env.DB)
    const found = persisted.find((b) => b.id === 'bot_testalpha')
    expect(found).toBeDefined()
    expect(found!.name).toBe('Test Bot Alpha')

    const userRow = await env.DB.prepare('SELECT display_name, tags, pfp_url FROM Users WHERE id = ?').bind('bot_testalpha').first()
    expect(userRow?.display_name).toBe('Test Bot Alpha')
    expect(String(userRow?.tags)).toContain('neon')
  })

  it('PUT /api/admin/bots/:id updates tags/name/enabled and re-syncs Users', async () => {
    const payload = JSON.stringify({ name: 'Test Bot Renamed', tags: 'gothic, rain', enabled: false })
    const res = await app.request('/api/admin/bots/bot_testalpha', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'PUT', '/api/admin/bots/bot_testalpha', payload),
      },
      body: payload,
    }, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bot.name).toBe('Test Bot Renamed')
    expect(body.bot.tags).toEqual(['gothic', 'rain'])
    expect(body.bot.enabled).toBe(false)

    const userRow = await env.DB.prepare('SELECT display_name, tags FROM Users WHERE id = ?').bind('bot_testalpha').first()
    expect(userRow?.display_name).toBe('Test Bot Renamed')
    expect(String(userRow?.tags)).toContain('gothic')
  })

  it('POST /api/admin/bots/:id/picture with customUrl persists pfp and syncs Users', async () => {
    const payload = JSON.stringify({ customUrl: 'https://cdn.example.com/bot-alpha.png' })
    const res = await app.request('/api/admin/bots/bot_testalpha/picture', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/bots/bot_testalpha/picture', payload),
      },
      body: payload,
    }, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bot.pfp_url).toBe('https://cdn.example.com/bot-alpha.png')

    const userRow = await env.DB.prepare('SELECT pfp_url FROM Users WHERE id = ?').bind('bot_testalpha').first()
    expect(userRow?.pfp_url).toBe('https://cdn.example.com/bot-alpha.png')
  })

  it('POST /api/admin/bots/:id/picture fails cleanly when no provider returns an image', async () => {
    await saveBotConfig(env.DB, {
      providers: [{ id: 'prov_fail', name: 'Fail', providerType: 'generic', url: 'https://invalid-non-existent-api-url.xyz/test', tags: ['x'], enabled: true }],
      enabled: true,
    })
    const res = await app.request('/api/admin/bots/bot_testalpha/picture', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/bots/bot_testalpha/picture', '{}'),
      },
      body: '{}',
    }, env)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('DELETE /api/admin/bots/:id removes a duelist', async () => {
    const res = await app.request('/api/admin/bots/bot_testalpha', {
      method: 'DELETE',
      headers: authHeaders(adminId, 'DELETE', '/api/admin/bots/bot_testalpha'),
    }, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    const persisted = await getBotProfiles(env.DB)
    expect(persisted.find((b) => b.id === 'bot_testalpha')).toBeUndefined()
  })

  it('DELETE rejects removing the last enabled duelist', async () => {
    await env.DB.prepare('UPDATE Bots SET enabled = 0').run()
    const keeper = await env.DB.prepare('SELECT id FROM Bots ORDER BY id LIMIT 1').first<{ id: string }>()
    expect(keeper).toBeDefined()
    await env.DB.prepare('UPDATE Bots SET enabled = 1 WHERE id = ?').bind(keeper!.id).run()

    const res = await app.request(`/api/admin/bots/${keeper!.id}`, {
      method: 'DELETE',
      headers: authHeaders(adminId, 'DELETE', `/api/admin/bots/${keeper!.id}`),
    }, env)
    expect(res.status).toBe(409)
  })

  // ─── Anti-tag / Negative Tag Support ───

  it('buildApiRequestUrl preserves anti-tags (- prefix) for booru providers', () => {
    const provider = {
      url: 'https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1',
      providerType: 'gelbooru' as const,
      apiKey: 'test-key',
      userId: '123',
    }
    const tags = ['1girl', 'solo', '-ai_generated', '-bikini']
    const { url } = buildApiRequestUrl(provider, tags, 'test-key', 10, '123')
    expect(url).toContain('tags=1girl+solo+-ai_generated+-bikini')
  })

  it('buildApiRequestUrl preserves anti-tags for danbooru', () => {
    const provider = {
      url: 'https://danbooru.donmai.us/posts.json',
      providerType: 'danbooru' as const,
      apiKey: 'test-key',
      userId: 'user',
    }
    const tags = ['1girl', '-ai_generated', '-3d']
    const { url } = buildApiRequestUrl(provider, tags, 'test-key', 10, 'user')
    expect(url).toContain('tags=1girl+-ai_generated+-3d')
  })

  it('buildApiRequestUrl preserves anti-tags for rule34', () => {
    const provider = {
      url: 'https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1',
      providerType: 'rule34' as const,
      apiKey: 'test-key',
      userId: '123',
    }
    const tags = ['1girl', '-ai_generated']
    const { url } = buildApiRequestUrl(provider, tags, 'test-key', 10, '123')
    expect(url).toContain('tags=1girl+-ai_generated')
  })

  it('saveBotConfig / getBotConfig round-trips anti-tags correctly', async () => {
    await saveBotConfig(env.DB, {
      providers: [
        {
          id: 'prov_test1',
          name: 'Test Provider',
          providerType: 'gelbooru',
          url: 'https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1',
          apiKey: 'key',
          userId: '123',
          tags: ['1girl', 'solo', '-ai_generated', '-bikini'],
          enabled: true,
          weight: 10,
        },
      ],
      tags: ['1girl', 'scenery', '-ai_generated', '-lowres'],
      names: ['TestBot'],
      enabled: true,
    })

    const config = await getBotConfig(env.DB)
    const provider = config.providers.find((p) => p.id === 'prov_test1')
    expect(provider).toBeDefined()
    expect(provider?.tags).toContain('-ai_generated')
    expect(provider?.tags).toContain('-bikini')
    expect(config.tags).toContain('-ai_generated')
    expect(config.tags).toContain('-lowres')
  })
})
