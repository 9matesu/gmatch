"use client";

import { useState } from 'react'
import { orbitFetch } from '../utils/api'
import type { OrbitIdentity } from '@orbit/crypto'
import { Lightbulb, X, Send } from 'lucide-react'

export function RecommendationModal({
  identity,
  onClose,
  toast,
}: {
  identity: OrbitIdentity
  onClose: () => void
  toast: (msg: string, type?: 'error' | 'success' | 'info') => void
}) {
  const [category, setCategory] = useState<'Feature' | 'UI' | 'Idea' | 'Bug'>('Feature')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return

    setSubmitting(true)
    try {
      const res = await orbitFetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, content: content.trim() }),
      }, identity)

      if (res.ok) {
        toast('Recommendation submitted.', 'success')
        onClose()
      } else {
        const errText = await res.text()
        toast(`Submission failed: ${errText}`, 'error')
      }
    } catch {
      toast('Failed to submit recommendation', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans" onClick={onClose}>
      <div className="bg-surface-canvas border border-border-glass rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl backdrop-blur-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-glass pb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-surface-canvas border border-border-glass flex items-center justify-center text-retro-body">
              <Lightbulb className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-bold text-retro-fg uppercase tracking-wider">
              Feedback &amp; Suggestions
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-retro-muted hover:text-retro-fg p-1 rounded-md hover:bg-surface-elevated transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-retro-muted leading-relaxed">
          Share your ideas, feature requests, UI improvements, or bug reports directly with the platform maintainers.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-retro-muted uppercase tracking-wider mb-1.5">
              Category
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['Feature', 'UI', 'Idea', 'Bug'] as const).map(cat => (
                <button
                  type="button"
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                    category === cat
                      ? 'bg-surface-interactive text-retro-fg font-bold border-border-glass shadow-sm'
                      : 'bg-surface-canvas/60 text-retro-muted border-border-glass hover:text-retro-body hover:bg-surface-elevated'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-retro-muted uppercase tracking-wider mb-1.5">
              Suggestion Details
            </label>
            <textarea
              rows={4}
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full p-3 bg-surface-canvas/80 border border-border-glass text-xs text-retro-fg placeholder:text-retro-muted rounded-lg outline-none focus:border-retro-accent resize-none transition-colors"
              placeholder="Describe your idea, feedback, or improvement in detail..."
              required
            />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="py-2 px-4 text-xs font-semibold text-retro-muted hover:text-retro-body border border-border-glass hover:bg-surface-canvas rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !content.trim()}
              className="py-2 px-4 bg-surface-interactive hover:bg-glass-w12 text-retro-fg font-bold text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5 shadow-md"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'Submitting...' : 'Submit Suggestion'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
