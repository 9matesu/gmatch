import { useEffect, useState } from 'react';
import { useGame, SETUP_TAG_COUNT } from '../game/store';
import { normalizeCustomTag, validateCustomTag } from '../game/tags';
import { fetchPosts } from '../services/booru';

/**
 * "Tune your feed" onboarding step (folded in from the legacy idle
 * SetupScreen): the player picks exactly SETUP_TAG_COUNT starter tags — no
 * hardcoded defaults exist. Each pick is validity-gated instantly and
 * live-probed (debounced) before the forward action unlocks. Optional extra
 * excludes are collected here and editable later in Settings → Feed.
 */

type FieldStatus = 'empty' | 'invalid' | 'checking' | 'live' | 'dead';

interface Field {
  value: string;
  status: FieldStatus;
  detail: string;
}

const BLANK: Field = { value: '', status: 'empty', detail: '' };

const DOT_STYLE: Record<FieldStatus, string> = {
  empty: 'bg-white/20',
  invalid: 'bg-red-500',
  checking: 'bg-amber-400 animate-pulse',
  live: 'bg-emerald-500',
  dead: 'bg-red-500',
};

function splitExcludes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.toLowerCase().trim())
    .filter(Boolean);
}

const inputCls =
  'flex-1 min-w-0 bg-surface-raised border border-border-glass rounded-xl px-3 py-2 text-xs text-retro-fg outline-none focus:border-retro-accent placeholder:text-retro-muted/60';

export function FeedTuneStep({ onFinished }: { onFinished: () => void }) {
  const alreadyDone = useGame((s) => s.setupComplete);
  const [fields, setFields] = useState<Field[]>(() =>
    Array.from({ length: SETUP_TAG_COUNT }, () => ({ ...BLANK })),
  );
  const [excludeInput, setExcludeInput] = useState('');
  const [excludes, setExcludes] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const valuesKey = fields.map((f) => f.value).join('\n');

  // Debounced validity + live probe per field (cancelled on re-type/unmount).
  useEffect(() => {
    let cancelled = false;
    const values = fields.map((f) => f.value);
    const t = window.setTimeout(() => {
      void (async () => {
        const next: Field[] = [];
        const probeJobs: { index: number; name: string }[] = [];
        values.forEach((raw, i) => {
          if (!raw.trim()) {
            next[i] = { value: raw, status: 'empty', detail: '' };
            return;
          }
          const verdict = validateCustomTag(raw);
          if (!verdict.ok) {
            const why =
              verdict.reason === 'blocked'
                ? 'blocked'
                : verdict.reason === 'noise'
                  ? 'no content'
                  : verdict.reason === 'too-long'
                    ? 'too long'
                    : 'too short';
            next[i] = { value: raw, status: 'invalid', detail: why };
            return;
          }
          next[i] = { value: raw, status: 'checking', detail: 'probing…' };
          probeJobs.push({ index: i, name: verdict.name });
        });
        if (!cancelled) setFields(next);
        const results = await Promise.all(
          probeJobs.map(async (job) => {
            try {
              const res = await fetchPosts({ tags: job.name, limit: 3 });
              return { ...job, live: res.ok && res.posts.length > 0 };
            } catch {
              return { ...job, live: false };
            }
          }),
        );
        if (cancelled) return;
        setFields((prev) =>
          prev.map((f, i) => {
            const r = results.find((x) => x.index === i);
            if (!r || f.status !== 'checking') return f;
            return {
              ...f,
              status: r.live ? 'live' : 'dead',
              detail: r.live ? 'live' : 'no results',
            };
          }),
        );
      })();
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [valuesKey]);

  const setFieldValue = (index: number, value: string) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, value } : f)));
  };

  const addExcludes = () => {
    const fresh = splitExcludes(excludeInput).filter((t) => t.length <= 40 && !excludes.includes(t));
    if (fresh.length > 0) setExcludes((prev) => [...prev, ...fresh].slice(0, 100));
    setExcludeInput('');
  };

  const names = fields.map((f) => normalizeCustomTag(f.value)).filter(Boolean);
  const uniqueLive = fields.filter((f) => f.status === 'live').map((f) => normalizeCustomTag(f.value));
  const ready =
    fields.every((f) => f.status === 'live') && new Set(names).size === SETUP_TAG_COUNT;

  const start = () => {
    // Already tuned (e.g. resumed after finishing elsewhere) -> just move on.
    if (useGame.getState().setupComplete) {
      onFinished();
      return;
    }
    // Excludes must not blank the picks (substring rule both ways).
    const clash = excludes.find((x) => uniqueLive.some((n) => n.includes(x) || x.includes(n)));
    if (clash) {
      setNote(`Exclude “${clash}” would block a starter tag — remove the exclude or change that tag.`);
      return;
    }
    setNote(null);
    setStarting(true);
    const r = useGame.getState().completeSetup(uniqueLive, excludes);
    if (!r.ok) {
      setNote(r.message);
      setStarting(false);
      return;
    }
    onFinished();
  };

  if (alreadyDone) {
    return (
      <div className="rounded-md border border-retro-accent/40 bg-retro-accent/10 p-5 text-sm text-retro-muted">
        Your feed is already tuned — {SETUP_TAG_COUNT} starter tags steer every fetch. Adjust
        excludes any time in <strong className="text-retro-fg">Settings → Feed</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {fields.map((f, i) => (
          <label key={i} className="flex items-center gap-2.5">
            <span className="w-5 shrink-0 text-center font-mono text-xs text-retro-muted">{i + 1}</span>
            <input
              className={inputCls}
              value={f.value}
              placeholder={`Starter tag ${i + 1} — e.g. creampie`}
              aria-label={`Starter tag ${i + 1}`}
              onChange={(e) => setFieldValue(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  start();
                }
              }}
            />
            <span
              className="flex w-20 shrink-0 items-center gap-1.5 text-[10px] text-retro-muted"
              title={f.detail || f.status}
            >
              <span className={`w-2 h-2 rounded-full ${DOT_STYLE[f.status]}`} aria-hidden="true" />
              <span className="font-mono">{f.detail}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className={inputCls}
          value={excludeInput}
          placeholder="Extra excludes — feet, watersports… (comma/space separated)"
          aria-label="Extra excluded tags"
          onChange={(e) => setExcludeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addExcludes();
            }
          }}
        />
        <button
          type="button"
          disabled={!excludeInput.trim()}
          onClick={addExcludes}
          className="px-3 py-2 rounded-xl border border-border-glass text-xs font-bold text-retro-fg disabled:opacity-30 hover:bg-surface-interactive cursor-pointer shrink-0"
        >
          Add
        </button>
      </div>

      {excludes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {excludes.map((x) => (
            <span
              key={x}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-glass bg-white/5 px-2.5 py-1 text-[11px] font-mono text-retro-fg"
            >
              {x}
              <button
                type="button"
                aria-label={`Remove exclude ${x}`}
                onClick={() => setExcludes((prev) => prev.filter((t) => t !== x))}
                className="text-retro-muted hover:text-red-400 cursor-pointer"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {note && (
        <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {note}
        </div>
      )}

      <button
        type="button"
        disabled={!ready || starting}
        onClick={start}
        title={ready ? 'Start the grid' : `All ${SETUP_TAG_COUNT} tags must probe live first`}
        className="w-full px-5 py-2.5 rounded-md chrome-accent text-sm font-black text-black disabled:opacity-40 cursor-pointer"
      >
        {starting ? 'Starting…' : 'Start'}
      </button>
    </div>
  );
}
