import { Fragment, type ReactNode } from 'react'
import { tokenizeUrls } from '../utils/linkify'

/**
 * Render free-form user text with URLs as safe anchors. Reuses the tested
 * tokenizer; stopPropagation keeps row/bubble onClick handlers from firing
 * when the user clicks a link.
 */
export function Linkify({ text, linkClassName = 'underline break-all' }: {
  text: string
  linkClassName?: string
}): ReactNode {
  return (
    <>
      {tokenizeUrls(text).map((t, i) =>
        t.type === 'url' ? (
          <a
            key={i}
            href={t.value}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
            onClick={(e) => e.stopPropagation()}
          >
            {t.value.length > 60 ? `${t.value.slice(0, 60)}...` : t.value}
          </a>
        ) : (
          <Fragment key={i}>{t.value}</Fragment>
        ),
      )}
    </>
  )
}