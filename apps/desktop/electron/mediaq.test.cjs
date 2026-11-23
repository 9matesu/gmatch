'use strict'
// Adapter unit + contract test for the mediaq ContentProvider (mediaq 0.1.0).
// The SearchResult fixture below is frozen from the mediaq 0.1.0 model
// (core/models.py), so a schema change on their side fails HERE, not in prod.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createMediaqProvider, toBooruPost } = require('./providers/mediaq.cjs')

const item = (over = {}) => ({
  site: 'rule34', kind: 'image', id: '123', title: 'x',
  page_url: 'https://rule34.xxx/index.php?r=posts/view/123',
  thumb_url: 'https://img.rule34.xxx/thumb.jpg',
  preview_url: 'https://img.rule34.xxx/preview.jpg',
  tags: ['blonde', 'solo'], ...over,
})

test('toBooruPost maps a MediaItem to the internal BooruPost', () => {
  const p = toBooruPost(item())
  assert.equal(p.url, 'https://img.rule34.xxx/thumb.jpg')
  assert.equal(p.preview, 'https://img.rule34.xxx/preview.jpg')
  assert.equal(p.source_url, 'https://rule34.xxx/index.php?r=posts/view/123')
  assert.equal(p.rating, 'explicit')
  assert.deepEqual(p.tags, ['blonde', 'solo'])
  assert.ok(p.id.startsWith('mq-rule34-'))
})

test('toBooruPost drops extensionless thumbs and junk (never shows a broken tile)', () => {
  assert.equal(toBooruPost(item({ thumb_url: 'https://cdn/noext' })), null)
  assert.equal(toBooruPost(null), null)
  assert.equal(toBooruPost({}), null)
})

test('fetch builds sites from the allowed categories and maps items', async () => {
  const calls = []
  const postJson = async (url, body) => { calls.push({ url, body }); return { items: [item()] } }
  const prov = createMediaqProvider({ baseUrl: 'http://127.0.0.1:8765', postJson })
  const out = await prov.fetch('blonde', 10, { allowReal: true, allowHentai: false })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://127.0.0.1:8765/search')
  assert.ok(calls[0].body.sites.includes('pornhub'))
  assert.ok(!calls[0].body.sites.includes('nhentai'))
  assert.equal(out.length, 1)
  assert.equal(out[0].rating, 'explicit')
})

test('fetch includes hentai sites only when hentai is allowed', async () => {
  const calls = []
  const postJson = async (u, b) => { calls.push(b); return { items: [] } }
  const prov = createMediaqProvider({ baseUrl: 'http://x', postJson })
  await prov.fetch('alpha', 5, { allowReal: false, allowHentai: true })
  assert.ok(calls[0].sites.includes('nhentai'))
  assert.ok(!calls[0].sites.includes('pornhub'))
})

test('fetch returns [] for an empty query and caps at limit', async () => {
  const postJson = async () => ({ items: [item({ id: '1' }), item({ id: '2' }), item({ id: '3' })] })
  const prov = createMediaqProvider({ baseUrl: 'http://x', postJson })
  assert.deepEqual(await prov.fetch('   ', 5, {}), [])
  const out = await prov.fetch('alpha', 2, {})
  assert.equal(out.length, 2)
})

test('a transport failure propagates so the mechanism cools the provider (circuit breaker)', async () => {
  const postJson = async () => { throw new Error('quality-gate timeout') }
  const prov = createMediaqProvider({ baseUrl: 'http://x', postJson })
  await assert.rejects(() => prov.fetch('alpha', 5, {}), /quality-gate timeout/)
})

test('capabilities: one provider serves both categories (never duplicated)', () => {
  const prov = createMediaqProvider({ baseUrl: 'http://x', postJson: async () => ({ items: [] }) })
  assert.equal(prov.id, 'mediaq')
  assert.deepEqual(prov.capabilities.categories, ['real', 'hentai'])
})