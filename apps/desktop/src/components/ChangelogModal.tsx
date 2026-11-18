'use client'

import { Modal, Button } from '../ui/kit'

export interface ChangelogModalProps {
  isOpen: boolean
  onClose: () => void
}

export const CURRENT_CHANGELOG_VERSION = '1.6.0'

/**
 * One entry per change, in the reader's words.
 *
 * This used to be four hard-coded cards, each with a coloured icon and a
 * paragraph of marketing copy that claimed things like "ensures screen-sharing
 * never turns black". Two problems: the prose was mostly reassurance rather
 * than information, and it was never updated. The body was still the 1.5.1 text
 * after 1.5.2 shipped, so the changelog described a superseded release.
 *
 * So: a flat list, one line each, saying what changed and nothing else. No
 * icons, no adjective that does no work. When you cut a release, replace the
 * list.
 */
const CHANGES: string[] = [
  'Media: one picker everywhere — your keepsakes, a file drop, or a pasted link, all previewed before anything attaches. Saved keepsakes come from your own machine, not a re-download.',
  'Posts: a new Vault button pins the real media to your encrypted local vault in one click, and one quiet banner shows sync progress instead of chips on every post.',
  'Comments: commenter names are now clickable and open that profile.',
  'Domination: video popups open in their own window, images ride sealed peer-to-peer, and every effect now reports honest success or failure. Prompts show who is asking, not a string of characters.',
  'First login: no guided tour and no toast fanfare — the Help guide opens once, and the app itself is the welcome.',
  'Admin: the Admin button only shows up when you actually host the node or administer it.',
]

export function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
  if (!isOpen) return null

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          What&apos;s New
          <span className="px-1.5 py-0.5 rounded text-2xs font-mono font-bold bg-retro-accent/20 text-retro-accent border border-retro-accent/30">
            v{CURRENT_CHANGELOG_VERSION}
          </span>
        </span>
      }
      onClose={onClose}
      dismissable
      maxWidth="max-w-lg"
    >
      <ul className="space-y-3 list-disc pl-4 marker:text-retro-muted text-xs leading-relaxed text-retro-body max-h-[60vh] overflow-y-auto styled-scrollbar">
        {CHANGES.map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>

      <div className="pt-3 border-t border-border-glass flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      </div>
    </Modal>
  )
}
