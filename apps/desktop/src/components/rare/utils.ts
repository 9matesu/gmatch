import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Vendored from RareUI's `lib/utils.ts` (MIT + Commons Clause + Attribution,
 *  https://rareui.com). The shadcn `cn` helper the rare components expect. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
