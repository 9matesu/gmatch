import { useEffect, useState } from 'react';
import { useGame, SETUP_TAG_COUNT } from '../game/store';
import { normalizeCustomTag, validateCustomTag } from '../game/tags';
import { SUGGESTED_EXCLUDES } from '../game/tagFilter';
import { fetchPosts } from '../services/booru';

/**
 * "Tune your feed" onboarding step (folded in from the legacy idle
 * SetupScreen): the player picks exactly SETUP_TAG_COUNT starter tags — no
 * hardcoded defaults exist. Each pick is validity-gated instantly and
 * live-probed (debounced) before the forward action unlocks. Optional extra
 * excludes are collected here and editable later in Settings → Feed.
 */

type FieldStatus = 'empty' | 'invalid' | 'checking' | 'live' | 'unverified';

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
  unverified: 'bg-zinc-500',
};

function splitExcludes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.toLowerCase().trim())
    .filter(Boolean);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('probe timeout')), ms);
    promise.finally(() => window.clearTimeout(t)).then(resolve, reject);
  });
}

export function FeedTuneStep({ onFinished }: { onFinished: () => void }) {
  const alreadyDone = useGame((s) => s.setupComplete);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<Field[]>(() => {
    const owned = useGame
      .getState()
      .tags.filter((t) => t.selected !== false)
      .map((t) => t.name)
      .slice(0, SETUP_TAG_COUNT);
    return Array.from({ length: SETUP_TAG_COUNT }, (_, i) => ({ ...BLANK, value: owned[i] ?? '' }));
  });
  const [excludeInput, setExcludeInput] = useState('');
  const [excludes, setExcludes] = useState<string[]>(() => {
    const stored = useGame.getState().userExcludes;
    return Array.isArray(stored) ? [...stored] : [];
  });
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
              const res = await withTimeout(fetchPosts({ tags: job.name, limit: 3 }), 2500);
              return { ...job, ok: res.ok, count: res.posts.length };
            } catch {
              return { ...job, ok: false, count: 0 };
            }
          }),
        );
        if (cancelled) return;
        setFields((prev) =>
          prev.map((f, i) => {
            const r = results.find((x) => x.index === i);
            if (!r || f.status !== 'checking') return f;
            const live = r.ok && r.count > 0;
            return {
              ...f,
              status: live ? 'live' : 'unverified',
              detail: live ? 'live' : r.ok ? 'no results' : 'offline',
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

  const isValid = (f: Field) =>
    f.status === 'live' || f.status === 'unverified' || f.status === 'checking';
  // Commit every syntactically-valid pick (live or merely unverified).
  const uniqueValid = [...new Set(fields.filter(isValid).map((f) => normalizeCustomTag(f.value)))];
  const allLive = fields.every((f) => f.status === 'live');
  // Validity gate (plan §7): exactly N distinct valid tags. Probe failures
  // (mirror offline / no results) only warn — they must never block progress.
  const ready = fields.every(isValid) && uniqueValid.length === SETUP_TAG_COUNT;

  const start = () => {
    const tuned = useGame.getState().setupComplete;
    // Already tuned and not re-editing (e.g. resumed after finishing elsewhere)
    // -> just move on.
    if (tuned && !editing) {
      onFinished();
      return;
    }
    // Enter must obey the exact same gate as the Start button.
    if (!ready) return;
    // Excludes must not blank the picks (substring rule both ways).
    const clash = excludes.find((x) => uniqueValid.some((n) => n.includes(x) || x.includes(n)));
    if (clash) {
      setNote(`Exclude “${clash}” would block a starter tag — remove the exclude or change that tag.`);
      return;
    }
    setNote(null);
    setStarting(true);
    const g = useGame.getState();
    const r = tuned ? g.updateSetup(uniqueValid, excludes) : g.completeSetup(uniqueValid, excludes);
    if (!r.ok) {
      setNote(r.message);
      setStarting(false);
      return;
    }
    onFinished();
  };

  if (alreadyDone && !editing) {
    return (
      <div className="space-y-3">
        <div className="glass-inset p-5 text-sm text-retro-muted">
          Your feed is already tuned — {SETUP_TAG_COUNT} starter tags steer every fetch. Adjust
          excludes any time in <strong className="text-retro-fg">Settings → Feed</strong>.
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="glass-action flex-1 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer"
          >
            Change starter tags
          </button>
          <button
            type="button"
            onClick={onFinished}
            className="glass-action glass-action-primary flex-1 px-5 py-2.5 rounded-lg text-sm font-bold cursor-pointer"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-y-auto styled-scrollbar pr-1 space-y-3">
        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)_5rem] items-center gap-2">
              <span className="text-center font-mono text-xs text-retro-muted">{i + 1}</span>
              <input
                className="glass-field min-w-0 px-3 py-2 text-xs"
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
                className="flex min-w-0 items-center gap-1.5 text-[10px] text-retro-muted"
                title={f.detail || f.status}
              >
                <span className={`w-2 h-2 shrink-0 rounded-full ${DOT_STYLE[f.status]}`} aria-hidden="true" />
                <span className="truncate font-mono">{f.detail}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            className="glass-field flex-1 min-w-0 px-3 py-2 text-xs"
            value={excludeInput}
            placeholder="Extra excludes — comma/space separated"
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
            disabled={!excludeInput.trim() || excludes.length >= 100}
            onClick={addExcludes}
            className="glass-action shrink-0 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-30"
          >
            Add
          </button>
        </div>
        {excludes.length >= 100 && (
          <p className="text-[10px] text-retro-muted">Maximum 100 personal excludes reached — remove one before adding another.</p>
        )}

        {excludes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {excludes.map((x) => (
              <span
                key={x}
                className="glass-inset inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-mono"
              >
                <span className="truncate">{x}</span>
                <button
                  type="button"
                  aria-label={`Remove exclude ${x}`}
                  onClick={() => setExcludes((prev) => prev.filter((t) => t !== x))}
                  className="shrink-0 text-retro-muted hover:text-rose-300 cursor-pointer"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-retro-muted">
            One-tap excludes
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_EXCLUDES.filter((x) => !excludes.includes(x)).map((x) => (
              <button
                key={x}
                type="button"
                disabled={excludes.length >= 100}
                onClick={() => setExcludes((prev) => [...prev, x].slice(0, 100))}
                className="glass-action rounded-full px-2 py-1 text-[10px] font-mono text-retro-muted disabled:opacity-30 cursor-pointer"
              >
                + {x}
              </button>
            ))}
          </div>
        </div>

        {note && (
          <div role="alert" className="glass-action glass-action-danger rounded-lg p-3 text-sm">
            {note}
          </div>
        )}

        {ready && !allLive && (
          <div className="glass-inset rounded-lg p-3 text-xs text-amber-100">
            Some starter tags could not be verified live. You can still start — the grid falls back until they resolve.
          </div>
        )}
      </div>

      <div className="glass-header shrink-0 -mx-5 -mb-5 px-5 py-4">
        <button
          type="button"
          disabled={!ready || starting}
          onClick={start}
          title={
            !ready
              ? `Enter ${SETUP_TAG_COUNT} distinct, valid starter tags`
              : allLive
                ? 'Start the grid'
                : 'Tags not verified live — start anyway'
          }
          className="glass-action glass-action-primary w-full px-5 py-2.5 rounded-lg text-sm font-bold cursor-pointer"
        >
          {starting ? 'Starting…' : allLive ? 'Start' : 'Start anyway'}
        </button>
        {!ready && (
          <p className="mt-1 text-center text-[10px] text-retro-muted">
            Enter {SETUP_TAG_COUNT} distinct starter tags to continue.
          </p>
        )}
      </div>
    </div>
  );
}
