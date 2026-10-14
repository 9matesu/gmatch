// Builders for the repetitive booru source shapes (pure node: httpGet/parse
// injected), mirroring the updater-core/server-mode-core pattern. The old
// SOURCES array had 9 hand-copied closures that differed only by hostname.
'use strict'

// Post-view (exact file URL) expansion bounds, mirroring services/booru.ts.
const VIEW_POST_CAP = 6
const VIEW_POST_LANES = 3
const HTML_TIMEOUT_MS = 8000
const TIMEOUT_MS = 3500

// Page memory: recently-drawn pages per source+variant. Mirrors
// drawFreshPage in src/services/booru.ts, which the renderer path already
// had — the IPC path used a bare Math.random(), so small pools re-answered the
// same posts every round until the seen-set filtered them and the round came
// back empty (the "same pictures again" report).
const PAGE_MEMORY_DEPTH = 20
const recentPages = new Map()

function drawFreshPage(key, maxExclusive) {
  const pool = Math.max(1, maxExclusive)
  if (pool <= 1) return 0
  const seen = recentPages.get(key) || []
  for (let i = 0; i < 6; i++) {
    const p = Math.floor(Math.random() * pool)
    if (!seen.includes(p)) {
      recentPages.set(key, [...seen, p].slice(-PAGE_MEMORY_DEPTH))
      return p
    }
  }
  return Math.floor(Math.random() * pool)
}

/** Test hook: clear page memory between cases. */
function resetPageMemory() {
  recentPages.clear()
}

// Bounded-concurrency map (mirrors main.cjs/services); failures settle to
// undefined and are dropped.
async function mapLimit(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  const lanes = Math.min(Math.max(1, n), Math.max(items.length, 1))
  const lane = async () => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = await fn(items[i], i)
      } catch {
        out[i] = undefined
      }
    }
  }
  await Promise.all(Array.from({ length: lanes }, lane))
  return out.filter((v) => v !== undefined)
}

/** Danbooru-API (JSON) shape with random-pid + pid=0 retry.
 * pid window (0..999) matches the renderer dapiPass so both runtimes sample
 * the same deep pool. Pass { deterministic: true } for probes (pid 0).
 * Pids are drawn WITHOUT replacement (last 20 per source+variant) so a small
 * pool does not keep re-answering the same page until the round comes back
 * empty. */
function dapiSource(id, base, { httpGet, parse, negatives }, category = 'hentai') {
  return {
    id,
    category,
    fetch: async (variant, n, opts) => {
      const deterministic = !!(opts && opts.deterministic)
      // # ponytail: expanded random pid window (0..999) stops image repetition; fallback to 0
      const pid = deterministic ? 0 : drawFreshPage(`dapi::${id}::${variant}`, 1000)
      const query = (variant + ' rating:explicit ' + negatives()).trim()
      const url = (p) => `${base}/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(query)}&limit=${n}&json=1&pid=${p}`
      let posts = parse(await httpGet(url(pid), undefined, TIMEOUT_MS), base, `${id}-`)
      if (posts.length === 0 && pid > 0) {
        posts = parse(await httpGet(url(0), undefined, TIMEOUT_MS), base, `${id}-`)
      }
      return posts
    },
  }
}

/** booru.org subdomain HTML-list shape (WAF: no tags=, random pid page).
 * pid window (0..49 * 20) matches the renderer so both runtimes sample the
 * same pool. Pass { deterministic: true } for probes (pid 0). When
 * parseEntries/parsePost are supplied, post-view pages expand to exact file
 * URLs (guessed-url fallback); otherwise the legacy guessed path runs. */
function booruOrgSource(sub, { httpGet, parse, parseEntries, parsePost }, id = sub.split('.')[0], category = 'hentai') {
  return {
    id,
    category,
    fetch: async (variant, n, opts) => {
      // # ponytail: expanded pid sampling (0..49 * 20 = up to page 1000) for deep diversity
      const pid = opts && opts.deterministic ? 0 : drawFreshPage(`boorg::${sub}::${variant}`, 50) * 20
      const html = await httpGet(`https://${sub}/index.php?page=post&s=list&pid=${pid}`, undefined, HTML_TIMEOUT_MS)
      if (parseEntries && parsePost) {
        const strip = (e) => {
          const post = { ...e }
          delete post.postId
          return post
        }
        const all = parseEntries(html, variant)
        const withId = all.filter((e) => e.postId).slice(0, VIEW_POST_CAP)
        if (withId.length > 0) {
          const expanded = await mapLimit(withId, VIEW_POST_LANES, async (entry) => {
            try {
              const view = await httpGet(
                `https://${sub}/index.php?page=post&s=view&id=${entry.postId}`,
                undefined,
                HTML_TIMEOUT_MS,
              )
              const hit = parsePost(view)
              if (!hit || !hit.url) return undefined
              const post = strip(entry)
              post.url = hit.url
              post.kind = hit.kind || post.kind
              return post
            } catch {
              return undefined // guessed-url entry below keeps the round alive
            }
          })
          const byId = new Map(expanded.map((p) => [p.id, p]))
          return all.map((e) => byId.get(e.id) || strip(e)).slice(0, n)
        }
      }
      return parse(html, variant).slice(0, n)
    },
  }
}

/**
 * How long the first attempt is given alone before the runner hedges. A latency
 * budget, not a timeout — see the identical constant in the renderer's
 * src/services/booru/concurrency.ts.
 */
const HEDGE_AFTER_MS = 150

/**
 * Default acceptance: a value counts unless it is null/undefined or an EMPTY
 * array — "nothing here" is this system's way of saying no, and the primitive
 * replaced a helper whose contract was "the first attempt that yields a
 * non-empty result".
 */
const defaultAccept = (value) =>
  value == null ? null : Array.isArray(value) && value.length === 0 ? null : value

/**
 * Start attempts in order, at most `lanes` in flight, and resolve the first one
 * `accept` allows. Never rejects: a throwing attempt is a dead attempt, not a
 * dead round.
 *
 * This is the SAME primitive as the renderer's
 * src/services/booru/concurrency.ts#firstAnswer, and it exists in both
 * runtimes for the same reason — see BOORU-API.md §9 invariant 0d.
 *
 * What it replaced here: a stride loop whose lanes kept issuing requests AFTER
 * a winner was found. The old firstWithPosts resolved the caller, but the losing
 * lanes were ordinary async functions still walking their remaining attempts, so
 * a round that answered on its first mirror could still spend the whole phase
 * against the shared booru.org rate limiter. Taking thunks instead of
 * already-started promises is what makes "stop starting work" expressible.
 *
 * Width grows on two signals, because either alone is wrong: a rejected
 * (empty) attempt widens at once, and so does silence after HEDGE_AFTER_MS. The
 * first keeps a fast happy path at one request; the second stops a slow mirror
 * from holding the round's latency (booru-race.test.cjs asserts exactly this).
 */
function firstAnswer(attempts, lanes, accept, hedgeAfterMs) {
  const settle = accept || defaultAccept
  const hedgeMs = typeof hedgeAfterMs === 'number' ? hedgeAfterMs : HEDGE_AFTER_MS
  if (attempts.length === 0) return Promise.resolve(null)
  return new Promise((resolve) => {
    const maxWidth = Math.max(1, Math.min(lanes, attempts.length))
    let next = 0
    let inFlight = 0
    let rejected = 0
    let started = 0
    let widthFloor = 1
    let hedge = null
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      if (hedge !== null) clearTimeout(hedge)
      resolve(value)
    }
    const start = () => {
      if (done) return
      const width = Math.min(maxWidth, Math.max(1 + rejected, widthFloor))
      while (!done && inFlight < width && next < attempts.length) {
        const attempt = attempts[next]
        next += 1
        started += 1
        inFlight += 1
        Promise.resolve()
          .then(attempt)
          .then(
            (value) => onSettled(value),
            () => onSettled(null),
          )
      }
      if (done || next >= attempts.length || width >= maxWidth || hedge !== null) return
      hedge = setTimeout(() => {
        hedge = null
        if (done) return
        widthFloor = maxWidth
        start()
      }, hedgeMs)
      if (hedge && typeof hedge.unref === 'function') hedge.unref()
    }
    const onSettled = (value) => {
      inFlight -= 1
      if (value != null) {
        const allowed = settle(value)
        if (allowed != null) {
          finish(allowed)
          return
        }
      }
      rejected += 1
      if (started >= attempts.length && inFlight === 0) finish(null)
      else start()
    }
    start()
  })
}

/**
 * The relevance gate for the tagless booru.org lists, as a FUNCTION.
 *
 * It used to be an inline closure inside main.cjs's parseBooruOrgEntries, which
 * made it untestable: main.cjs requires electron and boots sidecars at module
 * scope, so no test could import it and the rule had drifted from the renderer's
 * before anyone could compare them. It lives here because this module is already
 * imported by main.cjs AND by both test suites (electron/*.test.cjs and
 * src/services/*.test.ts) - the one place in the repo where all three can see
 * the same code.
 *
 * The renderer's twin is src/services/booru/match.ts#tagsMatchQuery. CJS cannot
 * require TS, so the two are separate implementations of one rule, pinned to
 * each other by booruGateParity.test.ts - a case table, not a comment. Keep them
 * in step: see BOORU-API.md §9 invariant 0d.
 *
 * The rule: AND across every query word, whole-token containment on underscore
 * boundaries. The previous version was `t.includes(tok) || (t.length>=4 &&
 * tok.includes(t))`, which admitted a `celec` board post for a query of `cel`
 * and a post tagged `blacked_out` for `blacked` - i.e. whatever the niche page
 * happened to be showing. Those posts then cost up to six post-view fetches
 * inside the round budget and were dropped by the renderer anyway.
 */
function tagsMatchQuery(tags, query) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!tokens.length) return true
  const tagSet = tags.map((t) => String(t || '').toLowerCase().replace(/[\s-]+/g, '_'))
  const contains = (tag, token) => {
    if (!tag || !token) return false
    if (tag === token) return true
    return tag.includes(`_${token}_`) || tag.startsWith(`${token}_`) || tag.endsWith(`_${token}`)
  }
  return tokens.every((tok) => tagSet.some((tag) => contains(tag, tok)))
}

/** Keep only the list entries whose own tags answer `query`. */
function gateBooruOrgEntry(entry, query) {
  if (!entry) return null
  return tagsMatchQuery(entry.tags || [], query) ? entry : null
}

module.exports = {
  dapiSource,
  booruOrgSource,
  resetPageMemory,
  firstAnswer,
  HEDGE_AFTER_MS,
  tagsMatchQuery,
  gateBooruOrgEntry,
}
