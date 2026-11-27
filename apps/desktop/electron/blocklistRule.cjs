/**
 * The blocklist matcher — the CommonJS mirror of the canonical rule in
 * packages/shared/src/blocklist.ts.
 *
 * The Electron main process cannot import TypeScript, so it carries this
 * copy. The two are pinned against each other by a parity test
 * (apps/desktop/src/game/blocklistParity.test.ts): the renderer and the main
 * process enforce the same hard line, and a disagreement between them is a
 * safety hole, not a cosmetic bug.
 *
 * The rule: a term matches when it occurs in a tag ALIGNED TO A TOKEN
 * BOUNDARY (underscore-joined words; hyphens and spaces are the same
 * boundary), and the term may be a PREFIX of its token — so 'lolicon' and
 * 'teenager' stay blocked while 'fifteen' and 'grape' do not trip 'teen'
 * and 'rape'.
 */

function normalizeTagText(raw) {
  return String(raw).toLowerCase().replace(/[\s-]+/g, '_')
}

function hitsAtTokenStart(tag, term) {
  if (!tag || !term) return false
  let from = 0
  for (;;) {
    const i = tag.indexOf(term, from)
    if (i === -1) return false
    if (i === 0 || tag.charCodeAt(i - 1) === 95) return true // '_'
    from = i + 1
  }
}

module.exports = { normalizeTagText, hitsAtTokenStart }
