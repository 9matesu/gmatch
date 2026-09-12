import { useEffect, useState } from 'react';
import { useGame, SETUP_TAG_COUNT } from '../game/store';
import { normalizeCustomTag } from '../game/tags';
import { SUGGESTED_EXCLUDES } from '../game/tagFilter';
import { fetchPosts } from '../services/booru';

/**
 * "Pick your pleasure" onboarding step: the player taps exactly
 * SETUP_TAG_COUNT starter pills — no typing, no hardcoded defaults
 * committed anywhere. Each pick is validity-gated instantly and
 * live-probed (debounced) before Start unlocks. Optional one-tap
 * excludes are collected here and editable later in Settings → Feed.
 */

/** Curated, safe starter suggestions — all pass validateCustomTag. */
const STARTER_PILLS = [
  'milf', 'creampie', 'ahegao', 'doggystyle',
  'paizuri', 'cowgirl_position', 'femdom', 'bondage',
  'lingerie', 'stockings', 'cosplay', 'blowjob',
  'deepthroat', 'cum', 'anal', 'masturbation',
  'solo', 'pov', 'threesome', 'huge_breasts',
  'futanari', 'feet',
] as const;

type PickStatus = 'checking' | 'live' | 'unverified';

interface Pick {
  name: string;
  status: PickStatus;
}

const DOT: Record<PickStatus, string> = {
  checking: 'bg-amber-400 animate-pulse',
  live: 'bg-emerald-500',
  unverified: 'bg-retro-muted',
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('probe timeout')), ms);
    promise.finally(() => window.clearTimeout(t)).then(resolve, reject);
  });
}

export function FeedTuneStep({ onFinished }: { onFinished: () => void }) {
  const alreadyDone = useGame((s) => s.setupComplete);
  const [editing, setEditing] = useState(false);
  const [picks, setPicks] = useState<Pick[]>(() => {
    const owned = useGame
      .getState()
      .tags.filter((t) => t.selected !== false)
      .map((t) => t.name)
      .slice(0, SETUP_TAG_COUNT);
    return owned.map((name) => ({ name, status: 'checking' as PickStatus }));
  });
  const [excludes, setExcludes] = useState<string[]>(() => {
    const stored = useGame.getState().userExcludes;
    return Array.isArray(stored) ? [...stored] : [];
  });
  const [note, setNote] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const picksKey = picks.map((p) => p.name).join('\n');

  // Debounced live probe per pick (cancelled on change/unmount).
  useEffect(() => {
    let cancelled = false;
    const names = picks.map((p) => p.name);
    if (names.length === 0) return;
    const t = window.setTimeout(() => {
      void (async () => {
        const results = await Promise.all(
          names.map(async (name) => {
            try {
              const res = await withTimeout(fetchPosts({ tags: name, limit: 3 }), 2500);
              const live = res.ok && res.posts.length > 0;
              return { name, status: (live ? 'live' : 'unverified') as PickStatus };
            } catch {
              return { name, status: 'unverified' as PickStatus };
            }
          }),
        );
        if (cancelled) return;
        setPicks((prev) =>
          prev.map((p) => {
            const r = results.find((x) => x.name === p.name);
            return r ? { ...p, status: r.status } : p;
          }),
        );
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [picksKey]);

  const togglePill = (raw: string) => {
    const name = normalizeCustomTag(raw);
    if (!name) return;
    setPicks((prev) => {
      if (prev.some((p) => p.name === name)) {
        return prev.filter((p) => p.name !== name);
      }
      if (prev.length >= SETUP_TAG_COUNT) return prev;
      return [...prev, { name, status: 'checking' as PickStatus }];
    });
  };

  const removePick = (name: string) => {
    setPicks((prev) => prev.filter((p) => p.name !== name));
  };

  // Commit every pick — probe failures only warn, never block progress.
  const uniqueValid = [...new Set(picks.map((p) => p.name))];
  const allLive = picks.length > 0 && picks.every((p) => p.status === 'live');
  const ready = uniqueValid.length === SETUP_TAG_COUNT;

  const start = () => {
    const tuned = useGame.getState().setupComplete;
    // Already tuned and not re-editing (e.g. resumed after finishing elsewhere)
    // -> just move on.
    if (tuned && !editing) {
      onFinished();
      return;
    }
    // Start obeys the same gate as the button state.
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

  const pickedNames = new Set(picks.map((p) => p.name));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="min-h-0 flex-1 overflow-y-auto styled-scrollbar pr-1 space-y-4">
        {/* Chosen slots — big, tappable to remove */}
        <div aria-label="Chosen starter tags">
          <div className="flex flex-wrap gap-2 min-h-[44px]">
            {picks.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => removePick(p.name)}
                title={`${p.name} — tap to remove (${p.status === 'live' ? 'live' : p.status === 'checking' ? 'probing…' : 'unverified'})`}
                aria-label={`Remove ${p.name}`}
                className="inline-flex items-center gap-2 rounded-full border border-retro-accent/60 bg-retro-accent/15 px-4 py-2 text-sm font-bold text-retro-fg cursor-pointer transition-colors hover:bg-retro-accent/30"
              >
                <span className={`w-2.5 h-2.5 shrink-0 rounded-full ${DOT[p.status]}`} aria-hidden="true" />
                {p.name}
                <span aria-hidden="true" className="text-retro-muted font-normal">×</span>
              </button>
            ))}
            {Array.from({ length: SETUP_TAG_COUNT - picks.length }, (_, i) => (
              <span
                key={`empty-${i}`}
                className="inline-flex items-center rounded-full border border-dashed border-border-glass px-4 py-2 text-sm text-retro-muted"
              >
                pick {picks.length + i + 1}
              </span>
            ))}
          </div>
        </div>

        {/* Suggestion cloud — tap to fill slots, no typing */}
        <div>
          <p className="text-xs uppercase tracking-wider text-retro-muted mb-2">
            Tap to add
          </p>
          <div className="flex flex-wrap gap-2">
            {STARTER_PILLS.filter((t) => !pickedNames.has(t)).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => togglePill(t)}
                disabled={picks.length >= SETUP_TAG_COUNT}
                aria-pressed={false}
                className="rounded-full border border-border-glass bg-surface-raised px-4 py-2 text-sm text-retro-muted cursor-pointer transition-colors hover:text-retro-fg hover:border-retro-accent/50 disabled:opacity-30 disabled:cursor-default"
              >
                + {t}
              </button>
            ))}
          </div>
        </div>

        {/* One-tap excludes */}
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wider text-retro-muted">
            Never show
          </p>
          <div className="flex flex-wrap gap-1.5">
            {excludes.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setExcludes((prev) => prev.filter((t) => t !== x))}
                aria-label={`Remove exclude ${x}`}
                title={`${x} — tap to remove`}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-mono text-red-200 cursor-pointer hover:bg-red-500/25"
              >
                {x}
                <span aria-hidden="true">×</span>
              </button>
            ))}
            {SUGGESTED_EXCLUDES.filter((x) => !excludes.includes(x)).map((x) => (
              <button
                key={x}
                type="button"
                disabled={excludes.length >= 100}
                onClick={() => setExcludes((prev) => [...prev, x].slice(0, 100))}
                className="rounded-full border border-border-subtle px-3 py-1.5 text-xs font-mono text-retro-muted disabled:opacity-30 cursor-pointer hover:text-retro-fg hover:border-border-strong"
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

      <div className="shrink-0">
        <button
          type="button"
          disabled={!ready || starting}
          onClick={start}
          title={
            !ready
              ? `Tap ${SETUP_TAG_COUNT} pills to continue`
              : allLive
                ? 'Start the grid'
                : 'Tags not verified live — start anyway'
          }
          className="glass-action glass-action-primary w-full px-5 py-3 rounded-xl text-base font-bold cursor-pointer"
        >
          {starting ? 'Starting…' : allLive ? `Start (${picks.length}/${SETUP_TAG_COUNT})` : 'Start anyway'}
        </button>
        {!ready && (
          <p className="mt-1.5 text-center text-xs text-retro-muted">
            {picks.length}/{SETUP_TAG_COUNT} picked — tap {SETUP_TAG_COUNT - picks.length} more.
          </p>
        )}
      </div>
    </div>
  );
}
