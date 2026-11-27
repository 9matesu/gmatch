import { Linkify } from '../Linkify'
import { classes, COLOR, TYPE } from '../../ui/tokens'

/**
 * The written body of a post, on every surface. Blank lines are paragraph
 * breaks; a single newline inside a paragraph stays a soft line break. Links
 * are live, and the reading measure/leading are the app's own type tokens.
 *
 * This is the ONLY place a post body is printed: the timeline card and its
 * expansion never render the same words twice.
 */
export function PostBody({ text, className = '', typeClassName }: { text: string; className?: string; typeClassName?: string }) {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
  if (paragraphs.length === 0) return null
  return (
    <div
      className={classes(
        'space-y-3 whitespace-pre-wrap break-words leading-relaxed',
        typeClassName ?? TYPE.base, COLOR.fg, className,
      )}
    >
      {paragraphs.map((paragraph, index) => (
        <p key={index}>
          <Linkify text={paragraph} />
        </p>
      ))}
    </div>
  )
}
