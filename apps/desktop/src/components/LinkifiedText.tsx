
"use client";

import { memo } from 'react'
import { tokenizeUrls } from '../utils/linkify'

interface LinkifiedTextProps {
  text: string
  className?: string
}

export const LinkifiedText = memo(function LinkifiedText({ text, className }: LinkifiedTextProps) {
  const tokens = tokenizeUrls(text)

  return (
    <span className={className}>
      {tokens.map((token, i) =>
        token.type === 'url' ? (
          <a
            key={`${token.value}-${i}`}
            href={token.value}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-retro-accent underline decoration-dotted underline-offset-2 hover:text-retro-fg transition-colors break-all"
          >
            {token.value}
          </a>
        ) : (
          <span key={`t-${i}`}>{token.value}</span>
        )
      )}
    </span>
  )
})