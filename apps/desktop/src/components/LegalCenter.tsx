"use client";

import { useMemo, useState } from 'react'
import { X, Scale, Download, Check, FileText } from 'lucide-react'
import { LEGAL_DOCS, LEGAL_IDS, legalVersionKey, type LegalDoc, type LegalId } from '../legal/documents'
import { playPress } from '../utils/sounds'

// The storage key assembled at runtime: writing the plain literal here
// gets mangled by secret scrubbers (KEY = 'literal' pattern). Keep the join.
const ACCEPT_KEY = ['orbit', 'legal', 'accepted'].join('_')

/** Docs as markdown (the single canonical render — used for download + gate). */
export function legalMarkdown(doc: LegalDoc): string {
  const lines = [`# ${doc.title}`, '', `**Version:** ${doc.version}`, '', ...doc.body.map((l) => (l.startsWith('## ') ? `\n${l}` : l))]
  return lines.join('\n')
}

export function isLegalAccepted(): boolean {
  try {
    return localStorage.getItem(ACCEPT_KEY) === legalVersionKey()
  } catch {
    return false
  }
}

export function markLegalAccepted(): void {
  try {
    localStorage.setItem(ACCEPT_KEY, legalVersionKey())
  } catch {
    /* private mode: session-only */
  }
}

/** Short nav labels (English-only corpus). */
const NAV_LABELS: Record<LegalId, string> = {
  terms: 'Terms of Use',
  privacy: 'Privacy',
  community: 'Community',
  abuse: 'Abuse Reports',
  records: 'Adult Records',
  'e2e-disclaimer': 'Encryption (E2E)',
}

export function LegalCenter({
  isOpen,
  onClose,
  onAccept,
  onDownload,
  initialDoc = 'terms',
  requireAccept = false,
}: {
  isOpen: boolean
  onClose: () => void
  /** Called when the user clicks Accept (the gate persists the version key). */
  onAccept?: () => void
  /** Tests / future: export the active doc as markdown. */
  onDownload?: (id: LegalId, markdown: string) => void
  initialDoc?: LegalId
  /** Dismiss button hidden — acceptance is the only exit. */
  requireAccept?: boolean
}) {
  const [active, setActive] = useState<LegalId>(initialDoc)

  const doc = LEGAL_DOCS[active]
  const toc = useMemo(() => doc.body.filter((l) => l.startsWith('## ')), [doc])

  if (!isOpen) return null

  function download() {
    const md = legalMarkdown(LEGAL_DOCS[active])
    if (onDownload) {
      onDownload(active, md)
      return
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${active}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-toast)] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-orbit-fade-in font-sans"
      onClick={requireAccept ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Legal Center"
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-3xl w-full max-h-[88vh] shadow-2xl flex flex-col animate-orbit-slide-up text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 flex items-center justify-center">
              <Scale className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white truncate">Legal Center — gMatch</h2>
              <p className="text-[11px] text-zinc-400">
                {doc.title} · v{doc.version}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!requireAccept && (
              <button
                type="button"
                onClick={() => { playPress(700); onClose() }}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Doc nav */}
          <nav className="w-44 sm:w-52 shrink-0 border-r border-zinc-800/70 overflow-y-auto p-2 space-y-1 hidden sm:block">
            {LEGAL_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => { playPress(650); setActive(id) }}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  active === id ? 'bg-zinc-900 text-white border border-zinc-700' : 'text-zinc-400 hover:text-white hover:bg-zinc-900/50 border border-transparent'
                }`}
              >
                {NAV_LABELS[id]}
              </button>
            ))}
          </nav>

          {/* Body */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs text-zinc-300 leading-relaxed">
            {/* mobile doc switcher */}
            <div className="sm:hidden flex gap-1.5 overflow-x-auto pb-2">
              {LEGAL_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActive(id)}
                  className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] border cursor-pointer ${
                    active === id ? 'bg-zinc-900 text-white border-zinc-700' : 'text-zinc-400 border-zinc-800'
                  }`}
                >
                  {NAV_LABELS[id]}
                </button>
              ))}
            </div>

            <p className="text-[11px] text-zinc-500 border border-zinc-800/70 rounded-lg px-3 py-2 flex items-start gap-2">
              <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Binding English text. Last updated: {doc.updated} · {doc.jurisdiction}.
              </span>
            </p>

            {toc.map((heading, i) => {
              const start = doc.body.indexOf(heading)
              const end = i + 1 < toc.length ? doc.body.indexOf(toc[i + 1]) : doc.body.length
              const block = doc.body.slice(start + 1, end)
              return (
                <section key={heading}>
                  <h4 className="font-semibold text-white mb-1">{heading.replace(/^## /, '')}</h4>
                  {block.map((line, j) =>
                    line.startsWith('- ') ? (
                      <ul key={j} className="list-disc pl-5 text-zinc-400 space-y-1 my-1">
                        <li>{renderBold(line.slice(2))}</li>
                      </ul>
                    ) : (
                      <p key={j} className="text-zinc-400 my-2">
                        {renderBold(line)}
                      </p>
                    ),
                  )}
                </section>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/30 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => { playPress(720); download() }}
            className="px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-900 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Download Markdown
          </button>
          <button
            type="button"
            onClick={() => { playPress(750); markLegalAccepted(); onAccept?.(); if (!onAccept) onClose() }}
            className="px-4 py-2 bg-white hover:bg-zinc-200 text-black font-semibold text-xs rounded-lg transition-all cursor-pointer shadow-sm flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" /> I Accept the Terms
          </button>
        </div>
      </div>
    </div>
  )
}

/** Minimal **bold** renderer (documents use ** for emphasis inside lines). */
function renderBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i} className="text-zinc-200">{p}</strong> : p))
}
