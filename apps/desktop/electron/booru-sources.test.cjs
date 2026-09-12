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
  // force pid>0 path
  Math.random = () => 0.99
  const posts = await src.fetch('solo_tag', 10)
  assert.equal(posts.length, 1, 'retry served posts')
  assert.ok(urls[0].includes('pid=7'), `first pid high: ${urls[0]}`)
  assert.ok(urls[1].includes('pid=0'), 'fallback retried pid=0')
  assert.ok(decodeURIComponent(urls[0]).includes('solo_tag rating:explicit -bad'), 'negatives in query')
  assert.equal(src.id, 'tbib')

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
  console.log('booru-sources tests passed')
})()
