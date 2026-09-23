// node booru-sources-core.cjs test — plain asserts, mirrors admin-pin.test.cjs.
const assert = require('assert')
const { dapiSource, booruOrgSource } = require('./booru-sources-core.cjs')

// dapiSource: retries pid=0 when the random pid comes back empty; negatives spliced in.
;(async () => {
  const urls = []
  let calls = 0
  const httpGet = async (u) => {
    urls.push(u)
    calls++
    return calls === 1 ? '{"posts":[]}' : JSON.stringify([{ id: 1, file_url: 'https://x/a.jpg', tags: 'a', rating: 'e', width: 800, height: 800 }])
  }
  const parse = (body, baseUrl) => { assert.ok(baseUrl);
    const d = JSON.parse(body)
    const list = Array.isArray(d) ? d : (d.posts && (d.posts.post ?? d.posts)) ?? []
    return list.length ? list.map((p) => ({ id: String(p.id), url: p.file_url })) : []
  }
  const src = dapiSource('tbib', 'https://tbib.org', { httpGet, parse, negatives: () => '-bad' })
  // force pid>0 path (window 0..999, shared with the renderer dapiPass)
  Math.random = () => 0.99
  const posts = await src.fetch('solo_tag', 10)
  assert.equal(posts.length, 1, 'retry served posts')
  assert.ok(urls[0].includes('pid=990'), `first pid high: ${urls[0]}`)
  assert.ok(urls[1].includes('pid=0'), 'fallback retried pid=0')
  assert.ok(decodeURIComponent(urls[0]).includes('solo_tag rating:explicit -bad'), 'negatives in query')
  assert.equal(src.id, 'tbib')

  // deterministic probes hit pid 0 (tag validation must not random-draw)
  urls.length = 0
  calls = 1
  const probePosts = await src.fetch('solo_tag', 10, { deterministic: true })
  assert.equal(probePosts.length, 1, 'probe served posts')
  assert.ok(urls[0].includes('pid=0'), `probe pid deterministic: ${urls[0]}`)

  // booruOrgSource: pid multiple of 20, parse receives (html, bSub, captions, variant)
  const seen = []
  const httpGet2 = async (u) => { seen.push(u); return 'HTML' }
  const parse2 = (html, query) => { assert.equal(html, 'HTML'); assert.equal(query, 'q1'); return [{ id: '1' }] }
  Math.random = () => 0.5
  const s2 = booruOrgSource('hgoon.booru.org', { httpGet: httpGet2, parse: parse2 })
  const r2 = await s2.fetch('q1', 5, false)
  assert.equal(r2.length, 1)
  assert.ok(seen[0].startsWith('https://hgoon.booru.org/index.php?page=post&s=list&pid='), seen[0])
  assert.equal(Number(new URL(seen[0]).searchParams.get('pid')) % 20, 0, 'pid multiple of 20')
  assert.equal(s2.id, 'hgoon')
  // deterministic probes hit pid 0
  seen.length = 0
  const r3 = await s2.fetch('q1', 5, { deterministic: true })
  assert.equal(r3.length, 1)
  assert.equal(new URL(seen[0]).searchParams.get('pid'), '0', 'probe pid deterministic')

  // view expansion: exact file URLs swap in; failures keep guessed urls.
  const seen3 = []
  const httpGet3 = async (u) => {
    seen3.push(u)
    if (u.includes('s=view')) {
      if (u.includes('id=7')) return '<img id="image" src="https://img.booru.org/hgoon//images/1/exact-7.png">'
      throw new Error('view 404')
    }
    return 'LIST'
  }
  const parse3 = () => [{ id: 'hgoon-x', url: 'https://img.booru.org/guessed.png', tags: [] }]
  const parseEntries3 = () => [
    { id: 'hgoon-7', url: 'https://img.booru.org/guessed-7.png', tags: [], postId: '7' },
    { id: 'hgoon-9', url: 'https://img.booru.org/guessed-9.png', tags: [], postId: '9' },
  ]
  const parsePost3 = (html) => {
    const m = /<img\b(?=[^>]*\bid="image")[^>]*\bsrc="([^"]+)"/i.exec(html)
    return m ? { url: m[1], kind: 'image' } : null
  }
  const s3 = booruOrgSource('hgoon.booru.org', { httpGet: httpGet3, parse: parse3, parseEntries: parseEntries3, parsePost: parsePost3 })
  const r4 = await s3.fetch('q', 5)
  assert.equal(r4.length, 2)
  assert.equal(r4[0].url, 'https://img.booru.org/hgoon//images/1/exact-7.png', 'expanded exact url wins')
  assert.equal(r4[1].url, 'https://img.booru.org/guessed-9.png', 'failed view keeps guessed url')
  assert.ok(!('postId' in r4[0]), 'postId stripped from output')
  assert.ok(seen3.some((u) => u.includes('s=view&id=7')), 'view page fetched')
  console.log('booru-sources tests passed')
})()
