'use strict'

/**
 * ContentProvider — the search mechanism's view of a content source.
 *
 * A provider is anything that can answer a tag query with normalized posts:
 *
 *   {
 *     id: string,
 *     capabilities: { categories: ('real'|'hentai')[], tagSupport?, kinds? },
 *     fetch(query, opts) -> Promise<BooruPost[]>
 *   }
 *
 * `fetch` returns BooruPost[] (or throws). It OWNS its own transport and wire
 * schema — the mechanism (`booruSources.cjs`) never learns a provider's
 * endpoints or response shape. Local booru mirrors and remote providers
 * (mediaq) implement the same shape.
 *
 * Capabilities are METADATA, not identity: one provider can serve several
 * categories (mediaq serves both 'real' and 'hentai'), so a provider is never
 * duplicated per category.
 *
 * @typedef {Object} ContentProvider
 * @property {string} id
 * @property {{ categories: Array<'real'|'hentai'>, tagSupport?: 'and'|'or'|'single'|'none'|'unknown' }} capabilities
 * @property {(query: string, opts?: { limit?: number, page?: number, deterministic?: boolean, allowReal?: boolean, allowHentai?: boolean, signal?: AbortSignal }) => Promise<Array>} fetch
 */

/**
 * Categories a source serves, from the modern `capabilities.categories` or the
 * legacy singular `category`. Both runtimes and the tests use one or the other,
 * so the mechanism reads them the same way.
 * @param {{ capabilities?: { categories?: string[] }, category?: string }} source
 * @returns {string[]}
 */
function categoriesOf(source) {
  const cats = source && source.capabilities && Array.isArray(source.capabilities.categories)
    ? source.capabilities.categories
    : null
  if (cats && cats.length) return cats
  return source && source.category ? [source.category] : []
}

module.exports = { categoriesOf }