import { useEffect, useState } from 'react'
import { useGame } from '../game/store'
import { SETUP_TAG_COUNT } from '../game/store'
import { normalizeCustomTag, validateCustomTag } from '../game/tags'
import { fetchPosts } from '../services/booru'

type FieldStatus = 'empty' | 'invalid' | 'checking' | 'live' | 'dead'

interface Field {
  value: string
  status: FieldStatus
  detail: string
}

const BLANK: Field = { value: '', status: 'empty', detail: '' }

function splitExcludes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.toLowerCase().trim())
    .filter(Boolean)
}

/**
 * First-run feed setup (user spec): the player picks exactly 4 starter tags —
 * no hardcoded defaults exist. Each pick is validity-gated instantly and
 * live-probed (debounced) before Start unlocks. Extra excludes can be added
 * here and later in the Config tab.
 */
export default function SetupScreen() {
  const completeSetup = useGame((s) => s.completeSetup)
  const [fields, setFields] = useState<Field[]>(() =>
    Array.from({ length: SETUP_TAG_COUNT }, () => ({ ...BLANK })),
  )
  const [excludeInput, setExcludeInput] = useState('')
  const [excludes, setExcludes] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // Debounced validity + live probe per field (cancelled on re-type/unmount).
  useEffect(() => {
    let cancelled = false
    const values = fields.map((f) => f.value)
    const t = window.setTimeout(() => {
      void (async () => {
        const next: Field[] = []
        const probeJobs: { index: number; name: string }[] = []
        values.forEach((raw, i) => {
          if (!raw.trim()) {
            next[i] = { value: raw, status: 'empty', detail: '' }
            return
          }
          const verdict = validateCustomTag(raw)
          if (!verdict.ok) {
            const why =
              verdict.reason === 'blocked'
                ? 'blocked'
                : verdict.reason === 'noise'
                  ? 'no content'
                  : verdict.reason === 'too-long'
                    ? 'too long'
                    : 'too short'
            next[i] = { value: raw, status: 'invalid', detail: why }
            return
          }
          next[i] = { value: raw, status: 'checking', detail: 'probing…' }
          probeJobs.push({ index: i, name: verdict.name })
        })
        if (!cancelled) setFields(next)
        const results = await Promise.all(
          probeJobs.map(async (job) => {
            try {
              const res = await fetchPosts({ tags: job.name, limit: 3 })
              return { ...job, live: res.ok && res.posts.length > 0 }
            } catch {
              return { ...job, live: false }
            }
          }),
        )
        if (cancelled) return
        setFields((prev) =>
          prev.map((f, i) => {
            const r = results.find((x) => x.index === i)
            if (!r || f.status !== 'checking') return f
            return {
              ...f,
              status: r.live ? 'live' : 'dead',
              detail: r.live ? 'live' : 'no results',
            }
          }),
        )
      })()
    }, 600)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [valuesKey])

  const setFieldValue = (index: number, value: string) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, value } : f)))
  }

  const addExcludes = () => {
    const fresh = splitExcludes(excludeInput).filter((t) => t.length <= 40 && !excludes.includes(t))
    if (fresh.length > 0) setExcludes((prev) => [...prev, ...fresh].slice(0, 100))
    setExcludeInput('')
  }

  const names = fields.map((f) => normalizeCustomTag(f.value)).filter(Boolean)
  const uniqueLive =
    fields.filter((f) => f.status === 'live').map((f) => normalizeCustomTag(f.value))
  const ready =
    fields.every((f) => f.status === 'live') && new Set(names).size === SETUP_TAG_COUNT

  const start = () => {
    // Excludes must not blank the picks (substring rule both ways).
    const clash = excludes.find((x) => uniqueLive.some((n) => n.includes(x) || x.includes(n)))
    if (clash) {
      setNote(`Exclude “${clash}” would block a starter tag — drop one of them.`)
      return
    }
    setNote(null)
    setStarting(true)
    const r = completeSetup(uniqueLive, excludes)
    if (!r.ok) {
      setNote(r.message)
      setStarting(false)
    }
  }

  return (
    <div className="overlay setup-gate">
      <div className="glass setup-card">
        <h2>Tune your feed</h2>
        <p>
          Pick exactly {SETUP_TAG_COUNT} starter tags — they steer every fetch. Each one is
          checked live before you start.
        </p>
        <div className="setup-fields">
          {fields.map((f, i) => (
            <label key={i} className="setup-row">
              <span className="mono setup-num">{i + 1}</span>
              <input
                className="custom-tag-input"
                value={f.value}
                placeholder={`Starter tag ${i + 1} — e.g. creampie`}
                aria-label={`Starter tag ${i + 1}`}
                onChange={(e) => setFieldValue(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    start()
                  }
                }}
              />
              <span className={`setup-status ${f.status}`} title={f.detail || f.status}>
                {f.status === 'checking' ? (
                  <span className="status-dot loading" aria-hidden="true" />
                ) : f.status === 'live' ? (
                  <span className="status-dot live" aria-hidden="true" />
                ) : f.status === 'dead' || f.status === 'invalid' ? (
                  <span className="status-dot offline" aria-hidden="true" />
                ) : (
                  <span className="status-dot empty" aria-hidden="true" />
                )}
                <span className="mono">{f.detail}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="market-head custom-tag-row">
          <input
            className="custom-tag-input"
            value={excludeInput}
            placeholder="Extra excludes — feet, watersports… (comma/space separated)"
            aria-label="Extra excluded tags"
            onChange={(e) => setExcludeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addExcludes()
              }
            }}
          />
          <button type="button" className="btn small" disabled={!excludeInput.trim()} onClick={addExcludes}>
            Add
          </button>
        </div>
        {excludes.length > 0 && (
          <div className="tag-pills setup-excludes">
            {excludes.map((x) => (
              <span key={x} className="tag-pill on">
                <span className="pill-name">{x}</span>
                <button
                  type="button"
                  className="pill-lv mono"
                  aria-label={`Remove exclude ${x}`}
                  onClick={() => setExcludes((prev) => prev.filter((t) => t !== x))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {note && <div className="muted custom-tag-note">{note}</div>}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready || starting}
          onClick={start}
          title={ready ? 'Start the grid' : 'All 4 tags must probe live first'}
        >
          {starting ? 'Starting…' : `Start with ${uniqueLive.length}/${SETUP_TAG_COUNT} live`}
        </button>
      </div>
    </div>
  )
}
