import { useEffect, useMemo, useState } from 'react'

/**
 * Client-side paging for a list that is already in memory (gallery, roster).
 * `resetKey` is the filter/query: when it changes, the page goes back to 0 —
//  otherwise a filter that shrinks the list leaves you on an empty page.
 */
export function usePagination<T>(items: T[], perPage: number, resetKey: unknown) {
  const [page, setPage] = useState(0)

  useEffect(() => {
    setPage(0)
  }, [resetKey])

  const totalPages = Math.max(1, Math.ceil(items.length / perPage))
  const pageItems = useMemo(
    () => items.slice(page * perPage, (page + 1) * perPage),
    [items, page, perPage],
  )

return { page, setPage, totalPages, pageItems }
}