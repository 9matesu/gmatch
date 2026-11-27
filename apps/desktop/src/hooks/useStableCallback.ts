import { useCallback, useRef } from 'react'

/**
 * A callback with a STABLE identity that always calls the latest closure.
 *
 * Why this exists: a memoized child is only skipped when every prop is the same
 * reference. Inline arrows are new on every render of the parent, so `memo` buys
 * nothing however expensive the child is. The alternative — hoisting every
 * handler and hand-tuning dependency arrays — is the refactor nobody finishes.
 *
 * This is the mechanical version: the identity never changes, the closure is
 * read at call time, so there is no stale-capture class of bug to reason about.
 *
 * Use it for event handlers passed down. Do NOT use it for values a render must
 * observe (a changing `count` prop), because the identity deliberately lies.
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const ref = useRef(fn)
  // Written during render, not in an effect: an event that fires before the
  // effect flushes would otherwise call the previous render's closure.
  ref.current = fn
  return useCallback((...args: Args) => ref.current(...args), [])
}