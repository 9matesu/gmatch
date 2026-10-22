import { useEffect, useMemo, useRef, useState } from 'react'
import { Images, Search, Tag } from 'lucide-react'
import { useGame } from '../../game/store'
import type { BooruPost } from '../../game/types'
import { browseQuery, dedupePosts, provenanceLabel } from '../../game/tagBrowse'
import { fetchPosts } from '../../services/booru'
import { offlineSvg } from '../../services/offlineSvg'
import CachedImg from '../../ui/CachedImg'
import MediaViewerModal from '../../ui/MediaViewerModal'
import { EmptyState } from '../EmptyState'
import { MUTED } from '../../ui/styles'

const PAGE_LIMIT = 30

/**
 * Tag-picker gallery browser.
 *
 * Pick owned tags (AND-ed, never OR-ed) and browse what the live providers
 * actually have. This is a read-only surface: it buys nothing, keeps nothing
 * and fetches with `silent`, so browsing cannot consume the feed's seen-ledger
 * or poison the tag-market memo.
 *
 * Provenance is stated under the grid (`provenanceLabel`) because an empty
 * grid that might just be a dead provider is exactly the kind of silent
 * failure the spec forbids (§6): if the network is down it says so.
 */
export default function TagBrowser({ onClose }: { onClose?: () => void }) {
  const tags = useGame((s) => s.tags)
  const owned = useMemo(() => tags.filter((t) => t.level > 0), [tags])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [posts, setPosts] = useState<BooruPost[]>([])
  const [status, setStatus] = useState('Pick tags to browse')
  const [loading, setLoading] = useState(false)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  // Discards stale responses: a slow round must not overwrite a newer one.
  const requestRef = useRef(0)

  const query = browseQuery([...selected])

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  useEffect(() => {
    if (!query) {
      requestRef.current += 1
      setPosts([])
      setLoading(false)
      setStatus('Pick tags to browse')
      return
    }
    const reqId = ++requestRef.current
    setLoading(true)
    void fetchPosts({ tags: query, limit: PAGE_LIMIT, silent: true })
      .then((res) => {
        if (reqId !== requestRef.current) return // a newer query won
        const clean = dedupePosts(res.posts || [])
        setPosts(clean)
        setStatus(provenanceLabel(res, clean.length))
      })
      .catch(() => {
        if (reqId === requestRef.current) setStatus('Offline: tag search failed')
      })
      .finally(() => {
        if (reqId === requestRef.current) setLoading(false)
      })
  }, [query, retry])

  const viewer = viewerId ? posts.find((p) => p.id === viewerId) || null : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tag picker */}
      <div className="shrink-0 border-b border-border-glass p-3">
        <div className="flex items-center gap-2 pb-2 text-xs text-retro-muted">
          <Tag className="h-3.5 w-3.5" />
          <span className="font-semibold uppercase tracking-wider">Browse by tag</span>
          {selected.size > 1 && <span className="text-retro-muted/70">· AND {selected.size}</span>}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-auto cursor-pointer underline hover:text-retro-fg"
            >
              clear
            </button>
          )}
        </div>
        {owned.length === 0 ? (
          <p className={`${MUTED} text-xs`}>Own tags in the Tag Market first; they seed the picker.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {owned.map((t) => {
              const on = selected.has(t.name)
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => toggle(t.name)}
                  aria-pressed={on}
                  className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                    on
                      ? 'border-retro-accent/70 bg-retro-accent/20 text-retro-fg'
                      : 'border-border-glass text-retro-muted hover:text-retro-body'
                  }`}
                >
                  {t.name} <span className="opacity-50">L{t.level}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Provenance line */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-retro-muted">
        {loading ? <span className="animate-pulse">Browsing {query}…</span> : <span>{status}</span>}
        {!loading && query && status.startsWith('Offline') && (
          <button type="button" className="ml-auto cursor-pointer underline hover:text-retro-fg" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        )}
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 styled-scrollbar">
        {posts.length === 0 ? (
          <EmptyState
            icon={selected.size ? Search : Images}
            title={selected.size ? 'Nothing to show' : 'No tags picked'}
            description={
              selected.size
                ? 'No live results for this combination. Try fewer tags or a different one.'
                : 'Select one or more owned tags above to browse what the providers have.'
            }
            compact
          />
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
            {posts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setViewerId(p.id)}
                title={p.tags.slice(0, 6).join(' ')}
                aria-label={`View image tagged ${p.tags.slice(0, 3).join(' ') || 'booru post'}`}
                className="group relative aspect-square cursor-pointer overflow-hidden rounded-[10px] border border-border-glass bg-black"
              >
                {p.kind === 'video' ? (
                  <video
                    className="block h-full w-full object-cover"
                    src={p.url}
                    poster={p.preview || undefined}
                    muted
                    preload="metadata"
                    playsInline
                  />
                ) : (
                  <CachedImg
                    className="block h-full w-full object-cover transition-transform group-hover:scale-105"
                    src={p.url || offlineSvg(p.tags)}
                    fallbackSrc={offlineSvg(p.tags)}
                    alt={p.tags.slice(0, 3).join(' ') || 'booru post'}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {viewer && (
        <MediaViewerModal onClose={() => setViewerId(null)} label="Tag browser viewer">
          <figure className="relative flex max-h-[80vh] min-h-0 w-auto max-w-full flex-col items-center">
            {viewer.kind === 'video' ? (
              <video
                src={viewer.url}
                poster={viewer.preview || undefined}
                className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
                controls
                autoPlay
                muted={false}
                loop
                playsInline
              />
            ) : (
              <img
                src={viewer.url || offlineSvg(viewer.tags)}
                alt={viewer.tags.slice(0, 3).join(' ') || 'booru post'}
                className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
                referrerPolicy="no-referrer"
              />
            )}
            <figcaption className={`${MUTED} mt-2 max-w-full truncate text-center text-xs`}>
              {viewer.tags.slice(0, 6).join(' ') || 'booru post'}
            </figcaption>
          </figure>
        </MediaViewerModal>
      )}

      {onClose && (
        <div className="shrink-0 border-t border-border-glass p-2 text-center">
          <button
            type="button"
            onClick={onClose}
            className="glass-action cursor-pointer rounded-lg px-3 py-1 text-xs font-semibold"
          >
            Close browser
          </button>
        </div>
      )}
    </div>
  )
}
