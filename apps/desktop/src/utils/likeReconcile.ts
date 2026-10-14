import { invalidateCache } from './api'

/**
 * Single-flight-per-post like mutation governor.
 *
 * Fixes three defects of firing the persist inside a setState updater:
 *  - StrictMode double-invokes updaters in dev, so one click fired two
 *    mutations; here the persist runs exactly once per toggle() call.
 *  - Out-of-order responses overwrote newer state; here each mutation takes
 *    a generation number and stale resolutions (or stale invalidations) are
 *    discarded — latest mutation wins, never latest response.
 *  - Failures stranded the optimistic state; here a failed mutation rolls
 *    back, unless a newer mutation already owns the post.
 */
export type LikePersist = (postId: string, liked: boolean) => Promise<number | undefined>

export interface LikeCommit {
  setLiked(postId: string, liked: boolean): void
  setCount(postId: string, count: number): void
}

export interface LikeToggleOpts {
  /** Defaults to a no-op that leaves the optimistic state standing. */
  persist?: LikePersist
  tags?: string[]
  /** Local-only flip (e.g. sponsored posts): no persist, no generation bump. */
  localOnly?: boolean
  /** Runs on the optimistic like edge (e.g. tag-affinity boost). */
  onOptimisticLike?: (postId: string, tags: string[]) => void
}

export function createLikeGovernor(commit: LikeCommit) {
  const gen = new Map<string, number>()
  return {
    toggle(postId: string, currentLiked: boolean, currentCount: number, opts: LikeToggleOpts = {}) {
      const next = !currentLiked
      commit.setLiked(postId, next)
      commit.setCount(postId, Math.max(0, currentCount + (next ? 1 : -1)))
      // Local affinity side effect (not a mutation): runs on the like edge in
      // every path, including local-only flips.
      if (next) opts.onOptimisticLike?.(postId, opts.tags ?? [])
      if (opts.localOnly || !opts.persist) return
      const g = (gen.get(postId) ?? 0) + 1
      gen.set(postId, g)
      opts.persist(postId, next).then(
        (count) => {
          if (gen.get(postId) !== g) return
          if (typeof count === 'number') commit.setCount(postId, count)
          invalidateCache('/api/posts')
        },
        () => {
          if (gen.get(postId) !== g) return
          commit.setLiked(postId, currentLiked)
          commit.setCount(postId, currentCount)
        },
      )
    },
  }
}

export type LikeGovernor = ReturnType<typeof createLikeGovernor>
