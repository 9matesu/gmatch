import { describe, it, expect, beforeAll } from 'vitest'
import { createMockEnv } from './test-utils'
import { getBotConfig, saveBotConfig, buildApiRequestUrl, extractImageUrlsFromJson } from './bot-image-api'

describe('Bot Image API — Unit Tests', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
  })

  // ─── Anti-tag / Negative Tag Support ───

  it('buildApiRequestUrl preserves anti-tags (- prefix) for gelbooru', () => {
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

  it('buildApiRequestUrl preserves anti-tags for safebooru', () => {
    const provider = {
      url: 'https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1',
      providerType: 'safebooru' as const,
      apiKey: '',
      userId: '',
    }
    const tags = ['1girl', '-ai_generated', '-bikini']
    const { url } = buildApiRequestUrl(provider, tags, '', 10, '')
    expect(url).toContain('tags=1girl+-ai_generated+-bikini')
  })

  it('buildApiRequestUrl preserves anti-tags for e621', () => {
    const provider = {
      url: 'https://e621.net/posts.json',
      providerType: 'e621' as const,
      apiKey: 'test-key',
      userId: 'user',
    }
    const tags = ['1girl', '-ai_generated']
    const { url } = buildApiRequestUrl(provider, tags, 'test-key', 10, 'user')
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

  it('saveBotConfig preserves empty providers array', async () => {
    await saveBotConfig(env.DB, {
      providers: [],
      tags: ['-ai_generated'],
      names: [],
      enabled: true,
    })

    const config = await getBotConfig(env.DB)
    expect(config.providers).toEqual([])
    expect(config.tags).toContain('-ai_generated')
  })

  it('extractImageUrlsFromJson prefers full-res over preview/thumbnail', () => {
    const extracted = extractImageUrlsFromJson([
      {
        file_url: 'https://x.test/full.jpg',
        preview_url: 'https://x.test/thumb.jpg',
        thumbnail: 'https://x.test/thumb2.jpg',
        tags: 'a b',
      },
    ])
    expect(extracted).toHaveLength(1)
    expect(extracted[0].url).toBe('https://x.test/full.jpg')
  })

  it('extractImageUrlsFromJson keeps short mp4 loops but drops long videos', () => {
    const extracted = extractImageUrlsFromJson({
      videos: [
        { id: 'long', length_sec: 1500, default_thumb: { src: 'https://x.test/long_thumb.jpg' } },
        { id: 'short', length_sec: 12, default_thumb: { src: 'https://x.test/short_thumb.jpg' } },
        { id: 'clip', file_url: 'https://media.redgifs.com/clip.mp4', tags: 'a' },
      ],
    })
    const urls = extracted.map((e) => e.url)
    expect(urls).not.toContain('https://x.test/long_thumb.jpg')
    expect(urls).toContain('https://x.test/short_thumb.jpg')
    expect(urls).toContain('https://media.redgifs.com/clip.mp4')
  })
})