import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Keyboard focus on a text field is drawn as an accent BORDER (the base layer
 * removes the outline for inputs). `focus:border-edge` and `focus:border-black`
 * therefore look identical to the resting state — in the dark theme the black
 * one is literally invisible — so a keyboard user cannot see where they are.
 * Pin the five surfaces that shipped that no-op style to the accent token.
 * A surface that now renders kit `Input`/`Textarea` inherits that border from
 * `FIELD.base` (ui/tokens.ts), so kit usage satisfies the same contract.
 */
const touched = [
  'firstRun/OnboardingFlow.tsx',
  'components/feed/CreatePostModal.tsx',
  'components/feed/PostComments.tsx',
  'components/games/RankingsPanel.tsx',
  'components/AttachmentUploadModal.tsx',
]

describe('visible keyboard focus on text fields', () => {
  for (const file of touched) {
    it(`${file} focuses with the accent token, not a no-op border`, () => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      expect(source).not.toMatch(/focus:border-(?:edge|black)\b/)
      expect(source).toMatch(/focus:border-retro-accent|<(?:Input|Textarea)\b/)
    })
  }
})
