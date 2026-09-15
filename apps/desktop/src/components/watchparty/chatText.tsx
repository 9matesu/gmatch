// Chat text renderer: URLs become safe anchors, everything else is plain.
import type { ReactNode } from 'react'

const URL_RE = /(https?:\/\/[^\s]+)/g

export function renderChatText(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index as number
    if (i > last) parts.push(text.slice(last, i))
    parts.push(
      <a key={i} href={m[0]} target="_blank" rel="noopener noreferrer" className="underline break-all">
        {m[0].length > 40 ? `${m[0].slice(0, 40)}...` : m[0]}
      </a>,
    )
    last = i + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
